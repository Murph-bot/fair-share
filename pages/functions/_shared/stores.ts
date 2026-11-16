import type { Env, R2Metadata } from "./env";

// ---------------------------------------------------------------- trips (D1)

export type TripRecord = { raw: unknown; revision: number };

export async function getTripRecord(env: Env, tripId: string): Promise<TripRecord | null> {
  const row = await env.FAIRSHARE_DB.prepare("SELECT payload, revision FROM trips WHERE id = ?")
    .bind(tripId)
    .first<{ payload: string; revision: number }>();
  if (!row) {
    return null;
  }
  try {
    return { raw: JSON.parse(row.payload) as unknown, revision: row.revision };
  } catch {
    return null;
  }
}

export async function getTripRaw(env: Env, tripId: string): Promise<unknown | null> {
  return (await getTripRecord(env, tripId))?.raw ?? null;
}

export async function insertTrip(env: Env, tripId: string, raw: unknown): Promise<void> {
  await env.FAIRSHARE_DB.prepare("INSERT INTO trips (id, payload, updated_at) VALUES (?, ?, ?)")
    .bind(tripId, JSON.stringify(raw), new Date().toISOString())
    .run();
}

export type TripSaveResult = { revision: number; photosLocked: boolean };

// One statement, so two saves from the same revision cannot both win, and a
// PIN set between the caller's read and this write is kept.
export async function replaceTripAtRevision(
  env: Env,
  tripId: string,
  trip: unknown,
  expectedRevision: number,
): Promise<TripSaveResult | null> {
  const row = await env.FAIRSHARE_DB.prepare(
    `UPDATE trips
     SET payload = CASE
           WHEN json_extract(payload, '$.pin_hash') IS NULL THEN ?1
           ELSE json_set(?1, '$.pin_hash', json_extract(payload, '$.pin_hash'))
         END,
         updated_at = ?2,
         revision = revision + 1
     WHERE id = ?3 AND revision = ?4
     RETURNING revision, json_extract(payload, '$.pin_hash') IS NOT NULL AS photos_locked`,
  )
    .bind(JSON.stringify(trip), new Date().toISOString(), tripId, expectedRevision)
    .first<{ revision: number; photos_locked: number }>();
  return row ? { revision: row.revision, photosLocked: Boolean(row.photos_locked) } : null;
}

/** Sets the PIN hash only if the trip has none. Returns false when it already had one or is gone. */
export async function setTripPinHash(env: Env, tripId: string, pinHash: string): Promise<boolean> {
  const result = await env.FAIRSHARE_DB.prepare(
    `UPDATE trips SET payload = json_set(payload, '$.pin_hash', ?1), updated_at = ?2
     WHERE id = ?3 AND json_extract(payload, '$.pin_hash') IS NULL`,
  )
    .bind(pinHash, new Date().toISOString(), tripId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Marks the trip as changed without bumping its revision, so clients' saves are unaffected. */
export async function touchTrip(env: Env, tripId: string): Promise<void> {
  await env.FAIRSHARE_DB.prepare("UPDATE trips SET updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), tripId)
    .run();
}

export async function listTripIdsNotChangedSince(
  env: Env,
  cutoffIso: string,
  limit: number,
): Promise<string[]> {
  const { results } = await env.FAIRSHARE_DB.prepare(
    "SELECT id FROM trips WHERE updated_at < ? ORDER BY updated_at LIMIT ?",
  )
    .bind(cutoffIso, limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
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
  const keys = new Set(listed.objects.map((obj) => obj.key));
  const photos: Array<{ photoId: string; uploadedAt: string; hasOriginal: boolean }> = [];
  for (const obj of listed.objects) {
    const rest = obj.key.slice(tripId.length + 1);
    // Display keys look like "<photoId>"; original keys look like "<photoId>/original".
    if (!rest || rest.includes("/")) {
      continue;
    }
    photos.push({
      photoId: rest,
      uploadedAt: obj.uploaded.toISOString(),
      hasOriginal: keys.has(originalKey(tripId, rest)),
    });
  }
  return photos;
}

export async function countPhotos(env: Env, tripId: string): Promise<number> {
  return (await listPhotos(env, tripId)).length;
}

/** Removes every object stored under the trip, display copies and originals alike. */
export async function deleteAllTripPhotos(env: Env, tripId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.FAIRSHARE_PHOTOS.list({ prefix: `${tripId}/`, cursor, limit: 1000 });
    if (listed.objects.length > 0) {
      await env.FAIRSHARE_PHOTOS.delete(listed.objects.map((obj) => obj.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
