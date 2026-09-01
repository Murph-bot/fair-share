import type { Config } from "@netlify/functions";
import { PHOTO_ID_RE, PHOTO_RETENTION_MS } from "../../web/src/domain/photos";
import { photosStore } from "./_shared/stores";

export default async () => {
  const store = photosStore();
  const cutoff = Date.now() - PHOTO_RETENTION_MS;
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
    await store.delete(blob.key);
  }
};

export const config: Config = {
  schedule: "@daily",
};
