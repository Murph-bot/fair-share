import { PHOTO_ID_RE, PHOTO_RETENTION_MS } from "../../../packages/domain/src/photos";
import { deletePhotoObject, listAllPhotoKeys } from "./stores";
import type { Env } from "./env";

export async function expireDuePhotos(env: Env, now = Date.now()): Promise<void> {
  const cutoff = now - PHOTO_RETENTION_MS;
  const keys = await listAllPhotoKeys(env);
  for (const { key, uploadedAt } of keys) {
    const created = Date.parse(uploadedAt);
    if (!Number.isFinite(created) || created > cutoff) {
      continue;
    }
    const parts = key.split("/");
    if (parts.length !== 2 || !PHOTO_ID_RE.test(parts[1] ?? "")) {
      // Original keys look like "<tripId>/<photoId>/original" and are removed
      // together with their display key below.
      continue;
    }
    await deletePhotoObject(env, parts[0] ?? "", parts[1] ?? "");
  }
}
