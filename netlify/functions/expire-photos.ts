import type { Config } from "@netlify/functions";
import { PHOTO_ID_RE, PHOTO_RETENTION_MS } from "../../packages/domain/src/photos";
import { destroyCloudinaryAsset } from "./_shared/cloudinary";
import { photosStore } from "./_shared/stores";

export async function expireDuePhotos(now = Date.now()): Promise<void> {
  const store = photosStore();
  const cutoff = now - PHOTO_RETENTION_MS;
  const { blobs } = await store.list();

  for (const blob of blobs) {
    const parts = blob.key.split("/");
    if (parts.length !== 2 || !PHOTO_ID_RE.test(parts[1])) {
      continue;
    }
    const meta = await store.getMetadata(blob.key);
    const uploadedAt = meta?.metadata?.uploadedAt;
    if (typeof uploadedAt !== "string") {
      continue;
    }
    const created = Date.parse(uploadedAt);
    if (!Number.isFinite(created) || created > cutoff) {
      continue;
    }
    const cloudinaryId = meta?.metadata?.cloudinaryId;
    if (typeof cloudinaryId === "string" && cloudinaryId) {
      try {
        await destroyCloudinaryAsset(cloudinaryId);
      } catch {
        /* still drop the display blob so Moments cannot serve expired photos */
      }
    }
    await store.delete(blob.key);
  }
}

export default async () => {
  await expireDuePhotos();
};

export const config: Config = {
  schedule: "@daily",
};
