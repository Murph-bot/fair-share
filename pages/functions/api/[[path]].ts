import { ValidationError } from "../../../packages/domain/src/errors";
import {
  createSessionToken,
  generatePin,
  hashPin,
  normalizePin,
  pinMatches,
  signPhotoAccess,
  verifySessionToken,
} from "../../../packages/domain/src/pin";
import {
  MAX_ORIGINAL_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_TRIP,
  PHOTO_ID_RE,
} from "../../../packages/domain/src/photos";
import { createTrip, newTripId, parseTrip, type Trip } from "../../../packages/domain/src/trip";
import {
  assertPinAllowed,
  clearPinFailures,
  countPhotos,
  deletePhotoObject,
  deleteTripRow,
  getPhoto,
  getTripRaw,
  listPhotos,
  putPhoto,
  recordPinFailure,
  setTripRaw,
} from "../_shared/stores";
import { expireDuePhotos } from "../_shared/expiry";
import {
  bearerToken,
  clientIp,
  corsPreflight,
  errorResponse,
  json,
  MAX_JSON_BYTES,
  pinHashFromRecord,
  pinPepper,
  publicTrip,
  readJsonBody,
} from "../_shared/http";
import type { Env } from "../_shared/env";

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function requirePhotoSession(
  req: Request,
  env: Env,
  tripId: string,
  pinHash: string | undefined,
): Promise<Response | null> {
  if (!pinHash) {
    return null;
  }
  const token = bearerToken(req);
  if (!token || !(await verifySessionToken(token, tripId, pinPepper(env)))) {
    return json(401, { error: "Photos PIN required" });
  }
  return null;
}

async function photoUrls(
  env: Env,
  tripId: string,
  photoId: string,
  locked: boolean,
  hasOriginal: boolean,
): Promise<{ displayUrl: string; thumbUrl: string; originalUrl: string | null }> {
  const base = `/uploads/photos/${tripId}/${photoId}`;
  let displayUrl = base;
  if (locked) {
    const { exp, sig } = await signPhotoAccess(tripId, photoId, pinPepper(env));
    displayUrl = `${base}?exp=${exp}&sig=${sig}`;
  }
  const originalUrl = hasOriginal ? `${displayUrl}${locked ? "&" : "?"}original=1` : null;
  return { displayUrl, thumbUrl: displayUrl, originalUrl };
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function handleTripRoutes(req: Request, env: Env, tripId: string): Promise<Response> {
  if (req.method === "GET") {
    const raw = await getTripRaw(env, tripId);
    if (raw === null) {
      return json(404, { error: "Trip not found" });
    }
    return json(200, publicTrip(parseTrip(raw), Boolean(pinHashFromRecord(raw))));
  }

  if (req.method === "PUT") {
    const existing = await getTripRaw(env, tripId);
    if (existing === null) {
      return json(404, { error: "Trip not found" });
    }
    const trip: Trip = parseTrip(await readJsonBody(req));
    const pinHash = pinHashFromRecord(existing);
    await setTripRaw(env, tripId, pinHash ? { ...trip, pin_hash: pinHash } : trip);
    return json(200, publicTrip(trip, Boolean(pinHash)));
  }

  if (req.method === "DELETE") {
    const existing = await getTripRaw(env, tripId);
    if (existing === null) {
      return json(404, { error: "Trip not found" });
    }
    const photos = await listPhotos(env, tripId);
    for (const photo of photos) {
      await deletePhotoObject(env, tripId, photo.photoId);
    }
    await deleteTripRow(env, tripId);
    return new Response(null, { status: 204 });
  }

  return json(405, { error: "Method not allowed" });
}

async function handleSession(req: Request, env: Env, tripId: string, ip: string): Promise<Response> {
  const raw = await getTripRaw(env, tripId);
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }
  const pinHash = pinHashFromRecord(raw);
  if (!pinHash) {
    throw new ValidationError("This trip does not lock photos");
  }

  const payload = await readJsonBody(req);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ValidationError("Body must be an object");
  }
  const pin = normalizePin(String((payload as { pin?: unknown }).pin ?? ""));
  if (!pin) {
    throw new ValidationError("PIN must be 6 digits");
  }

  await assertPinAllowed(env, tripId, ip);
  const pepper = pinPepper(env);
  if (!(await pinMatches(pin, tripId, pepper, pinHash))) {
    await recordPinFailure(env, tripId, ip);
    return json(401, { error: "Wrong PIN" });
  }
  await clearPinFailures(env, tripId, ip);
  const token = await createSessionToken(tripId, pepper);
  return json(200, { token });
}

// Anyone with the trip link may set a PIN once on a grandfathered trip that has no pin_hash.
// This matches the open trust model of the app (same as editing expenses).
// If a PIN has already been set, further attempts are rejected with 400 (no PIN rotation in v3).
async function handleSetPin(req: Request, env: Env, tripId: string, ip: string): Promise<Response> {
  const raw = await getTripRaw(env, tripId);
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }

  const existingPinHash = pinHashFromRecord(raw);
  if (existingPinHash) {
    throw new ValidationError("Trip already has a PIN");
  }

  await assertPinAllowed(env, tripId, ip);

  let pin: string | null = null;
  const rawText = await req.text();
  if (rawText.length > MAX_JSON_BYTES) {
    throw new ValidationError("Payload is too large");
  }
  if (rawText.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ValidationError("Invalid JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ValidationError("Body must be an object");
    }
    const pinVal = (parsed as { pin?: unknown }).pin;
    if (pinVal !== undefined && pinVal !== null && pinVal !== "") {
      const normalized = normalizePin(String(pinVal));
      if (!normalized) {
        throw new ValidationError("PIN must be 6 digits");
      }
      pin = normalized;
    }
  }

  if (!pin) {
    pin = generatePin();
  }

  const pepper = pinPepper(env);
  const pinHash = await hashPin(pin, tripId, pepper);
  const latest = await getTripRaw(env, tripId);
  if (latest === null) {
    return json(404, { error: "Trip not found" });
  }
  if (pinHashFromRecord(latest)) {
    throw new ValidationError("Trip already has a PIN");
  }
  const trip = parseTrip(latest);
  await setTripRaw(env, tripId, { ...trip, pin_hash: pinHash });
  await clearPinFailures(env, tripId, ip);
  const photosToken = await createSessionToken(tripId, pepper);
  return json(200, { pin, photos_token: photosToken });
}

async function handlePhotos(req: Request, env: Env, tripId: string, photoId?: string): Promise<Response> {
  const raw = await getTripRaw(env, tripId);
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }
  const pinHash = pinHashFromRecord(raw);
  const locked = Boolean(pinHash);

  if (photoId) {
    if (req.method !== "DELETE") {
      return json(405, { error: "Method not allowed" });
    }
    if (!PHOTO_ID_RE.test(photoId)) {
      return json(404, { error: "Photo not found" });
    }
    // If trip has a PIN configured, require an active photo session token.
    const denied = await requirePhotoSession(req, env, tripId, pinHash);
    if (denied) {
      return denied;
    }
    const existing = await getPhoto(env, tripId, photoId, false);
    if (!existing) {
      return json(404, { error: "Photo not found" });
    }
    await deletePhotoObject(env, tripId, photoId);
    return json(200, { ok: true });
  }

  if (req.method === "GET") {
    const denied = await requirePhotoSession(req, env, tripId, pinHash);
    if (denied) {
      return denied;
    }
    const photos = await listPhotos(env, tripId);
    const records = await Promise.all(
      photos.map(async ({ photoId: id, uploadedAt, hasOriginal }) => {
        const urls = await photoUrls(env, tripId, id, locked, hasOriginal);
        return { id, createdAt: uploadedAt, ...urls };
      }),
    );
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(200, { photos: records });
  }

  if (req.method === "POST") {
    const denied = await requirePhotoSession(req, env, tripId, pinHash);
    if (denied) {
      return denied;
    }
    if ((await countPhotos(env, tripId)) >= MAX_PHOTOS_PER_TRIP) {
      throw new ValidationError(`A trip can hold at most ${MAX_PHOTOS_PER_TRIP} photos`);
    }

    const form = await req.formData();

    const file = form.get("photo");
    if (!(file instanceof File)) {
      throw new ValidationError("Choose a photo to upload");
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new ValidationError("Photo is too large");
    }
    const type = file.type.toLowerCase();
    if (type !== "image/jpeg" && type !== "image/jpg") {
      throw new ValidationError("Photos must be JPEG");
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (!isJpeg(buffer)) {
      throw new ValidationError("Photos must be JPEG");
    }

    const original = form.get("original");
    let originalBuffer: Uint8Array | null = null;
    if (original instanceof File) {
      if (original.size > MAX_ORIGINAL_BYTES) {
        throw new ValidationError("Original is too large");
      }
      originalBuffer = new Uint8Array(await original.arrayBuffer());
      if (!isJpeg(originalBuffer)) {
        throw new ValidationError("Originals must be JPEG");
      }
    }

    const requestedId = formString(form, "photo_id");
    const photoId = requestedId ?? newTripId();
    if (!PHOTO_ID_RE.test(photoId)) {
      throw new ValidationError("Invalid photo id");
    }
    const existing = await getPhoto(env, tripId, photoId, false);
    if (existing) {
      throw new ValidationError("Photo already exists");
    }

    const uploadedAt = new Date().toISOString();
    await putPhoto(env, tripId, photoId, buffer, { contentType: "image/jpeg", uploadedAt }, originalBuffer);
    const urls = await photoUrls(env, tripId, photoId, locked, originalBuffer !== null);
    return json(201, {
      photo: { id: photoId, createdAt: uploadedAt, ...urls },
    });
  }

  return json(405, { error: "Method not allowed" });
}

export async function handleApiRequest(req: Request, env: Env): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return corsPreflight();
    }

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/admin/expire-photos") {
      if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
      }
      const secret = bearerToken(req);
      if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
        return json(403, { error: "Forbidden" });
      }
      await expireDuePhotos(env);
      return json(200, { ok: true });
    }

    if (path === "/api/trips" && req.method === "POST") {
      const payload = await readJsonBody(req);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw new ValidationError("Body must be an object");
      }
      const name = (payload as { name?: unknown }).name;
      if (typeof name !== "string") {
        throw new ValidationError("Trip name is required");
      }
      const trip = createTrip(name);
      const tripId = newTripId();
      const pepper = pinPepper(env);
      const pin = generatePin();
      const pinHash = await hashPin(pin, tripId, pepper);
      await setTripRaw(env, tripId, { ...trip, pin_hash: pinHash });
      const photosToken = await createSessionToken(tripId, pepper);
      return json(201, { id: tripId, trip: publicTrip(trip, true), pin, photos_token: photosToken });
    }

    const tripMatch = /^\/api\/trips\/([a-f0-9]{32})(\/.*)?$/.exec(path);
    if (!tripMatch) {
      return json(404, { error: "Not found" });
    }
    const tripId = tripMatch[1];
    const rest = tripMatch[2] ?? "";

    if (rest === "") {
      return await handleTripRoutes(req, env, tripId);
    }
    if (rest === "/session") {
      if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
      }
      return await handleSession(req, env, tripId, clientIp(req));
    }
    if (rest === "/pin") {
      if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
      }
      return await handleSetPin(req, env, tripId, clientIp(req));
    }
    const photosMatch = /^\/photos(?:\/([a-f0-9]{32}))?$/.exec(rest);
    if (photosMatch) {
      return await handlePhotos(req, env, tripId, photosMatch[1]);
    }

    return json(404, { error: "Not found" });
  } catch (err) {
    return errorResponse(err);
  }
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => handleApiRequest(context.request, context.env);
