import { RateLimitError } from "../../../packages/domain/src/errors";
import type { Env, R2Metadata, R2ObjectLike } from "./env";

const PIN_ATTEMPT_LIMIT = 8;
const PIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const PIN_TRIP_ATTEMPT_LIMIT = 50;
const PIN_TRIP_WINDOW_SECONDS = 24 * 60 * 60;

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

/** Revision counter stored inside the payload (absent on older rows = 0). */
export function revFromRecord(raw: unknown): number {
  if (typeof raw !== "object" || raw === null) {
    return 0;
  }
  const rev = (raw as { rev?: unknown }).rev;
  return typeof rev === "number" && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

/**
 * Atomic compare-and-set on the stored revision. Returns false when another
 * writer bumped the revision since `expectedRev` was read.
 */
export async function updateTripIfRev(
  env: Env,
  tripId: string,
  raw: unknown,
  expectedRev: number,
): Promise<boolean> {
  const result = await env.FAIRSHARE_DB.prepare(
    `UPDATE trips SET payload = ?, updated_at = ?
     WHERE id = ? AND COALESCE(json_extract(payload, '$.rev'), 0) = ?`,
  )
    .bind(JSON.stringify(raw), new Date().toISOString(), tripId, expectedRev)
    .run();
  const changes = (result.meta as { changes?: unknown } | undefined)?.changes;
  return typeof changes === "number" && changes > 0;
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
): Promise<{ data: ReadableStream | ArrayBuffer; contentType: string } | null> {
  const key = original ? originalKey(tripId, photoId) : displayKey(tripId, photoId);
  const obj = await env.FAIRSHARE_PHOTOS.get(key);
  if (!obj) {
    return null;
  }
  const contentType = obj.customMetadata?.contentType ?? "image/jpeg";
  // Stream when the binding gives us a body (real R2 does) to avoid
  // buffering 4-8 MB originals in the Function.
  return { data: obj.body ?? (await obj.arrayBuffer()), contentType };
}

export async function photoExists(env: Env, tripId: string, photoId: string): Promise<boolean> {
  return (await env.FAIRSHARE_PHOTOS.head(displayKey(tripId, photoId))) !== null;
}

export async function deletePhotoObject(env: Env, tripId: string, photoId: string): Promise<void> {
  await env.FAIRSHARE_PHOTOS.delete(displayKey(tripId, photoId));
  await env.FAIRSHARE_PHOTOS.delete(originalKey(tripId, photoId));
}

export async function listPhotos(
  env: Env,
  tripId: string,
): Promise<Array<{ photoId: string; uploadedAt: string; hasOriginal: boolean }>> {
  const objects: R2ObjectLike[] = [];
  let cursor: string | undefined;
  do {
    // R2 omits customMetadata from list results unless asked (r2_list_honor_include).
    const listed = await env.FAIRSHARE_PHOTOS.list({ prefix: `${tripId}/`, cursor, include: ["customMetadata"] });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const photos: Array<{ photoId: string; uploadedAt: string; hasOriginal: boolean }> = [];
  for (const obj of objects) {
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
    const listed = await env.FAIRSHARE_PHOTOS.list({ cursor, limit: 1000, include: ["customMetadata"] });
    for (const obj of listed.objects) {
      const uploadedAt = obj.customMetadata?.uploadedAt ?? obj.uploaded.toISOString();
      keys.push({ key: obj.key, uploadedAt });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}

// ----------------------------------------------------- PIN attempts (KV, TTL)

/**
 * Bucket an address for rate limiting. IPv6 hosts usually control a whole
 * /64, so rotating the interface id must not buy fresh attempts.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) {
    return ip.slice(0, 64);
  }
  const [head, tail] = ip.toLowerCase().split("::", 2);
  const headParts = head ? head.split(":") : [];
  const tailParts = tail === undefined ? [] : tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  return `${full.slice(0, 4).map((part) => part.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function attemptKey(tripId: string, ip: string): string {
  return `pin:attempts:${tripId}:${ipBucket(ip).replaceAll(":", "_").slice(0, 80)}`;
}

function tripAttemptKey(tripId: string): string {
  return `pin:trip:${tripId}`;
}

// Atomic increment-and-read in D1 (single writer), so parallel guesses
// cannot all pass a read-then-write check the way they could with KV.
const RESERVE_SQL = `INSERT INTO pin_attempts (key, count, reset_at) VALUES (?1, 1, ?2)
  ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN pin_attempts.reset_at <= ?3 THEN 1 ELSE pin_attempts.count + 1 END,
    reset_at = CASE WHEN pin_attempts.reset_at <= ?3 THEN excluded.reset_at ELSE pin_attempts.reset_at END
  RETURNING count`;

async function bump(env: Env, key: string, windowSeconds: number): Promise<number> {
  const now = Date.now();
  const row = await env.FAIRSHARE_DB.prepare(RESERVE_SQL)
    .bind(key, now + windowSeconds * 1000, now)
    .first<{ count: number }>();
  return row?.count ?? Number.MAX_SAFE_INTEGER;
}

async function currentCount(env: Env, key: string): Promise<number> {
  const row = await env.FAIRSHARE_DB.prepare("SELECT count FROM pin_attempts WHERE key = ?1 AND reset_at > ?2")
    .bind(key, Date.now())
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Read-only check (used before setting a PIN on a grandfathered trip). */
export async function assertPinAllowed(env: Env, tripId: string, ip: string): Promise<void> {
  if (
    (await currentCount(env, attemptKey(tripId, ip))) >= PIN_ATTEMPT_LIMIT ||
    (await currentCount(env, tripAttemptKey(tripId))) >= PIN_TRIP_ATTEMPT_LIMIT
  ) {
    throw new RateLimitError("Too many PIN attempts. Try again later.");
  }
}

/**
 * Count this attempt before the PIN is checked. Throws once the per-IP
 * (8 per 15 min) or per-trip (50 per day) budget is used up.
 */
export async function reservePinAttempt(env: Env, tripId: string, ip: string): Promise<void> {
  const perIp = await bump(env, attemptKey(tripId, ip), PIN_ATTEMPT_WINDOW_SECONDS);
  const perTrip = await bump(env, tripAttemptKey(tripId), PIN_TRIP_WINDOW_SECONDS);
  if (perIp > PIN_ATTEMPT_LIMIT || perTrip > PIN_TRIP_ATTEMPT_LIMIT) {
    throw new RateLimitError("Too many PIN attempts. Try again later.");
  }
}

/** After a correct PIN: reset this IP's counter and refund the trip-wide slot. */
export async function clearPinFailures(env: Env, tripId: string, ip: string): Promise<void> {
  await env.FAIRSHARE_DB.prepare("DELETE FROM pin_attempts WHERE key = ?1").bind(attemptKey(tripId, ip)).run();
  await env.FAIRSHARE_DB.prepare("UPDATE pin_attempts SET count = MAX(count - 1, 0) WHERE key = ?1")
    .bind(tripAttemptKey(tripId))
    .run();
}

export async function purgeExpiredPinAttempts(env: Env): Promise<void> {
  await env.FAIRSHARE_DB.prepare("DELETE FROM pin_attempts WHERE reset_at <= ?1").bind(Date.now()).run();
}
