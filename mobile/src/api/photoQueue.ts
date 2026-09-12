import { getStore } from "./storage";
import { uploadPhoto } from "./photoApi";
import type { PhotoPart } from "./photoApi";

const QUEUE_KEY = "fairshare.photo.queue";

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
};

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
      uploaded += 1;
    } catch {
      // Stop at the first failure; the rest retry on the next sync.
      break;
    }
  }
  return uploaded;
}
