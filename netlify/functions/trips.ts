import type { Config, Context } from "@netlify/functions";
import { ValidationError } from "../../packages/domain/src/errors";
import {
  createSessionToken,
  generatePin,
  hashPin,
  normalizePin,
  pinMatches,
} from "../../packages/domain/src/pin";
import { createTrip, newTripId, parseTrip, TRIP_ID_RE, type Trip } from "../../packages/domain/src/trip";
import {
  assertPinAllowed,
  clearPinFailures,
  corsHeaders,
  corsPreflight,
  errorResponse,
  json,
  MAX_JSON_BYTES,
  pinHashFromRecord,
  pinPepper,
  publicTrip,
  readJsonBody,
  recordPinFailure,
} from "./_shared/http";
import { photosStore, tripsStore } from "./_shared/stores";

export default async (req: Request, context: Context) => {
  try {
    const id = context.params?.id;
    const store = tripsStore();

    if (req.method === "OPTIONS") {
      return corsPreflight();
    }

    if (req.method === "POST" && !id) {
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
      const pepper = pinPepper();
      const pin = generatePin();
      const pin_hash = await hashPin(pin, tripId, pepper);
      await store.setJSON(tripId, { ...trip, pin_hash });
      const photos_token = await createSessionToken(tripId, pepper);
      return json(201, { id: tripId, trip: publicTrip(trip, true), pin, photos_token });
    }

    if (!id || !TRIP_ID_RE.test(id)) {
      return json(404, { error: "Trip not found" });
    }

    const url = new URL(req.url);
    const sessionPath = url.pathname.endsWith("/session");
    if (req.method === "POST" && sessionPath) {
      return await handleSession(req, id, context.ip ?? "unknown");
    }
    if (sessionPath) {
      return json(405, { error: "Method not allowed" });
    }

    const pinPath = url.pathname.endsWith("/pin");
    if (req.method === "POST" && pinPath) {
      return await handleSetPin(req, id, context.ip ?? "unknown");
    }
    if (pinPath) {
      return json(405, { error: "Method not allowed" });
    }

    if (req.method === "GET") {
      const raw = await store.get(id, { type: "json" });
      if (raw === null) {
        return json(404, { error: "Trip not found" });
      }
      return json(200, publicTrip(parseTrip(raw), Boolean(pinHashFromRecord(raw))));
    }

    if (req.method === "PUT") {
      const existing = await store.get(id, { type: "json" });
      if (existing === null) {
        return json(404, { error: "Trip not found" });
      }
      const trip: Trip = parseTrip(await readJsonBody(req));
      const pin_hash = pinHashFromRecord(existing);
      await store.setJSON(id, pin_hash ? { ...trip, pin_hash } : trip);
      return json(200, publicTrip(trip, Boolean(pin_hash)));
    }

    if (req.method === "DELETE") {
      const existing = await store.get(id, { type: "json" });
      if (existing === null) {
        return json(404, { error: "Trip not found" });
      }
      const photoStore = photosStore();
      const { blobs } = await photoStore.list({ prefix: `${id}/` });
      await Promise.all(blobs.map((blob) => photoStore.delete(blob.key)));
      await store.delete(id);
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return errorResponse(err);
  }
};

async function handleSession(req: Request, tripId: string, ip: string): Promise<Response> {
  const store = tripsStore();
  const raw = await store.get(tripId, { type: "json" });
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }
  const pin_hash = pinHashFromRecord(raw);
  if (!pin_hash) {
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

  await assertPinAllowed(tripId, ip);
  const pepper = pinPepper();
  if (!(await pinMatches(pin, tripId, pepper, pin_hash))) {
    await recordPinFailure(tripId, ip);
    return json(401, { error: "Wrong PIN" });
  }
  await clearPinFailures(tripId, ip);
  const token = await createSessionToken(tripId, pepper);
  return json(200, { token });
}

// Anyone with the trip link may set a PIN once on a grandfathered trip that has no pin_hash.
// This matches the open trust model of the app (same as editing expenses).
// If a PIN has already been set, further attempts are rejected with 400 (no PIN rotation in v3).
async function handleSetPin(req: Request, tripId: string, ip: string): Promise<Response> {
  const store = tripsStore();
  const raw = await store.get(tripId, { type: "json" });
  if (raw === null) {
    return json(404, { error: "Trip not found" });
  }

  const existingPinHash = pinHashFromRecord(raw);
  if (existingPinHash) {
    throw new ValidationError("Trip already has a PIN");
  }

  await assertPinAllowed(tripId, ip);

  let pin: string | null = null;
  const rawText = await req.text();
  if (rawText.trim().length > 0) {
    if (rawText.length > MAX_JSON_BYTES) {
      throw new ValidationError("Payload is too large");
    }
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

  const pepper = pinPepper();
  const pin_hash = await hashPin(pin, tripId, pepper);
  const latest = await store.get(tripId, { type: "json" });
  if (latest === null) {
    return json(404, { error: "Trip not found" });
  }
  if (pinHashFromRecord(latest)) {
    throw new ValidationError("Trip already has a PIN");
  }
  const trip = parseTrip(latest);
  await store.setJSON(tripId, { ...trip, pin_hash });
  await clearPinFailures(tripId, ip);
  const photos_token = await createSessionToken(tripId, pepper);
  return json(200, { pin, photos_token });
}

export const config: Config = {
  path: ["/api/trips", "/api/trips/:id", "/api/trips/:id/session", "/api/trips/:id/pin"],
};
