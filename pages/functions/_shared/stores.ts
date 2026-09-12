import { RateLimitError } from "../../../packages/domain/src/errors";
import type { Env, R2Metadata } from "./env";

const PIN_ATTEMPT_LIMIT = 8;
const PIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;

// ---------------------------------------------------------------- trips (D1)

export async function getTripRaw(env: Env, tripId: string): Promise<unknown | null> {
  const row = await env.FAIRSHARE_DB.prepare("SELECT payload FROM trips WHERE id = ?")
    .bind(tripId)
    .first<{ payload: string }>();
  if (!row) {
    return null;
  }
  try {
    return JSON.parse(row.payload) as unknown;
  } catch {
    return null;
  }
}

export async function setTripRaw(env: Env, tripId: string, raw: unknown): Promise<void> {
  await env.FAIRSHARE_DB.prepare(
    `INSERT INTO trips (id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  )
    .bind(tripId, JSON.stringify(raw), new Date().toISOString())
    .run();
}

export async function deleteTripRow(env: Env, tripId: string): Promise<void> {
  await env.FAIRSHARE_DB.prepare("DELETE FROM trips WHERE id = ?").bind(tripId).run();
}

// --------------------------------------------------------------- photos (R2)

export type PhotoMeta = {
  contentType: string;
  uploadedAt: string;
  hasOriginal: boolean;
};

function displayKey(tripId: string, photoId: string): string {
  return `${tripId}/${photoId}`;
}

function originalKey(tripId: string, photoId: string): string {
  return `${tripId}/${photoId}/original`;
}

export async function putPhoto(
  env: Env,
  tripId: string,
  photoId: string,
  bytes: ArrayBuffer | Uint8Array,
  meta: { contentType: string; uploadedAt: string },
  originalBytes: ArrayBuffer | Uint8Array | null,
): Promise<void> {
  const base: R2Metadata = {
    contentType: meta.contentType,
    uploadedAt: meta.uploadedAt,
    tripId,
  };
  await env.FAIRSHARE_PHOTOS.put(displayKey(tripId, photoId), bytes, {
    customMetadata: { ...base, hasOriginal: originalBytes ? "1" : "0" },
  });
  if (originalBytes) {
    await env.FAIRSHARE_PHOTOS.put(originalKey(tripId, photoId), originalBytes, {
      customMetadata: { ...base, hasOriginal: "1" },
    });
  }
}

export async function getPhoto(
  env: Env,
  tripId: string,
  photoId: string,
  original: boolean,
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const key = original ? originalKey(tripId, photoId) : displayKey(tripId, photoId);
  const obj = await env.FAIRSHARE_PHOTOS.get(key);
  if (!obj) {
    return null;
  }
  const contentType = obj.customMetadata?.contentType ?? "image/jpeg";
  return { data: await obj.arrayBuffer(), contentType };
}

export async function deletePhotoObject(env: Env, tripId: string, photoId: string): Promise<void> {
  await env.FAIRSHARE_PHOTOS.delete(displayKey(tripId, photoId));
  await env.FAIRSHARE_PHOTOS.delete(originalKey(tripId, photoId));
}

export async function listPhotos(
  env: Env,
  tripId: string,
): Promise<Array<{ photoId: string; uploadedAt: string; hasOriginal: boolean }>> {
  const listed = await env.FAIRSHARE_PHOTOS.list({ prefix: `${tripId}/` });
  const photos: Array<{ photoId: string; uploadedAt: string; hasOriginal: boolean }> = [];
  for (const obj of listed.objects) {
    const rest = obj.key.slice(tripId.length + 1);
    // Display keys look like "<photoId>"; original keys look like "<photoId>/original".
    if (!rest || rest.includes("/")) {
      continue;
    }
    const uploadedAt = obj.customMetadata?.uploadedAt ?? obj.uploaded.toISOString();
    photos.push({
      photoId: rest,
      uploadedAt,
      hasOriginal: obj.customMetadata?.hasOriginal === "1",
    });
  }
  return photos;
}

export async function countPhotos(env: Env, tripId: string): Promise<number> {
  return (await listPhotos(env, tripId)).length;
}

export async function listAllPhotoKeys(
  env: Env,
): Promise<Array<{ key: string; uploadedAt: string }>> {
  const keys: Array<{ key: string; uploadedAt: string }> = [];
  let cursor: string | undefined;
  do {
    const listed = await env.FAIRSHARE_PHOTOS.list({ cursor, limit: 1000 });
    for (const obj of listed.objects) {
      const uploadedAt = obj.customMetadata?.uploadedAt ?? obj.uploaded.toISOString();
      keys.push({ key: obj.key, uploadedAt });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}

// ----------------------------------------------------- PIN attempts (KV, TTL)

function attemptKey(tripId: string, ip: string): string {
  return `pin:attempts:${tripId}:${ip.replaceAll(":", "_").slice(0, 80)}`;
}

type AttemptState = { count: number; resetAt: number };

export async function assertPinAllowed(env: Env, tripId: string, ip: string): Promise<void> {
  const raw = (await env.PIN_ATTEMPTS.get(attemptKey(tripId, ip), "json")) as AttemptState | null;
  const now = Date.now();
  if (raw && raw.resetAt > now && raw.count >= PIN_ATTEMPT_LIMIT) {
    throw new RateLimitError("Too many PIN attempts. Try again later.");
  }
}

export async function recordPinFailure(env: Env, tripId: string, ip: string): Promise<void> {
  const key = attemptKey(tripId, ip);
  const raw = (await env.PIN_ATTEMPTS.get(key, "json")) as AttemptState | null;
  const now = Date.now();
  const active = raw && raw.resetAt > now;
  const resetAt = active ? raw.resetAt : now + PIN_ATTEMPT_WINDOW_SECONDS * 1000;
  const count = active ? raw.count + 1 : 1;
  await env.PIN_ATTEMPTS.put(key, JSON.stringify({ count, resetAt }), {
    expirationTtl: PIN_ATTEMPT_WINDOW_SECONDS,
  });
}

export async function clearPinFailures(env: Env, tripId: string, ip: string): Promise<void> {
  await env.PIN_ATTEMPTS.delete(attemptKey(tripId, ip));
}
