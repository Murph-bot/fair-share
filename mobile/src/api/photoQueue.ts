import { getStore } from "./storage";
import { uploadPhoto } from "./photoApi";
import type { PhotoPart } from "./photoApi";

const QUEUE_KEY = "fairshare.photo.queue";
const MAX_ATTEMPTS = 5;
const STAGING_DIR_MARKER = "/fairshare-queue/";

export type QueuedPhotoUpload = {
  tripId: string;
  photoId: string;
  displayUri: string;
  displayName: string;
  displayType: string;
  originalUri: string | null;
  originalName: string | null;
  originalType: string | null;
  createdAt: string;
  attempts?: number;
};

// Staged uploads live under app-owned document storage (see photoCache
// stagePhotoForQueue). If a staged file is gone the bytes are unrecoverable —
// the item can never succeed, so it leaves the queue.
async function stagedFileMissing(uri: string): Promise<boolean> {
  if (!uri.includes(STAGING_DIR_MARKER)) {
    return false;
  }
  try {
    const { File } = await import("expo-file-system");
    return !new File(uri).exists;
  } catch {
    return false;
  }
}

async function cleanupStaged(uri: string | null): Promise<void> {
  if (!uri || !uri.includes(STAGING_DIR_MARKER)) {
    return;
  }
  try {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    /* best-effort cleanup */
  }
}

export async function loadPhotoQueue(): Promise<QueuedPhotoUpload[]> {
  try {
    const raw = await getStore().getItem(QUEUE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is QueuedPhotoUpload =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as QueuedPhotoUpload).tripId === "string" &&
          typeof (item as QueuedPhotoUpload).photoId === "string" &&
          typeof (item as QueuedPhotoUpload).displayUri === "string",
      );
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function savePhotoQueue(queue: QueuedPhotoUpload[]): Promise<void> {
  try {
    await getStore().setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

export async function enqueuePhotoUpload(upload: QueuedPhotoUpload): Promise<void> {
  const queue = await loadPhotoQueue();
  queue.push(upload);
  await savePhotoQueue(queue);
}

export async function removePhotoUpload(tripId: string, photoId: string): Promise<void> {
  const queue = await loadPhotoQueue();
  const next = queue.filter((item) => !(item.tripId === tripId && item.photoId === photoId));
  if (next.length !== queue.length) {
    await savePhotoQueue(next);
  }
}

export async function pendingPhotoUploads(tripId: string): Promise<QueuedPhotoUpload[]> {
  const queue = await loadPhotoQueue();
  return queue.filter((item) => item.tripId === tripId);
}

export async function flushPhotoQueue(): Promise<number> {
  const queue = await loadPhotoQueue();
  if (queue.length === 0) {
    return 0;
  }
  let uploaded = 0;
  for (const item of queue) {
    if (await stagedFileMissing(item.displayUri)) {
      await removePhotoUpload(item.tripId, item.photoId);
      void cleanupStaged(item.originalUri);
      continue;
    }
    try {
      const display: PhotoPart = {
        uri: item.displayUri,
        name: item.displayName,
        type: item.displayType,
      };
      const original: PhotoPart | undefined = item.originalUri
        ? {
            uri: item.originalUri,
            name: item.originalName ?? "original.jpg",
            type: item.originalType ?? "image/jpeg",
          }
        : undefined;
      await uploadPhoto(item.tripId, display, { photoId: item.photoId, ...(original ? { original } : {}) });
      await removePhotoUpload(item.tripId, item.photoId);
      void cleanupStaged(item.displayUri);
      void cleanupStaged(item.originalUri);
      uploaded += 1;
    } catch (caught) {
      // Network failure: the rest would fail too — retry on the next sync.
      if (caught instanceof TypeError) {
        break;
      }
      // A permanent failure must not block the queue forever; after a few
      // tries the item is dropped so later photos can sync.
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await removePhotoUpload(item.tripId, item.photoId);
        void cleanupStaged(item.displayUri);
        void cleanupStaged(item.originalUri);
      } else {
        const next = (await loadPhotoQueue()).map((queued) =>
          queued.tripId === item.tripId && queued.photoId === item.photoId
            ? { ...queued, attempts }
            : queued,
        );
        await savePhotoQueue(next);
      }
    }
  }
  return uploaded;
}
