import { getDataStore } from "./storage";
import { saveTrip, TripConflictError } from "./tripApi";
import type { Trip } from "../domain";

const QUEUE_KEY = "fairshare.mutation.queue";

const MAX_ATTEMPTS = 5;

export type QueuedMutation = {
  tripId: string;
  trip: Trip;
  /** Server revision the snapshot was made from. */
  revision?: number;
  timestamp: string;
  attempts?: number;
};

function readQueue(raw: string | null): QueuedMutation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is QueuedMutation =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as QueuedMutation).tripId === "string" &&
          typeof (item as QueuedMutation).timestamp === "string" &&
          typeof (item as QueuedMutation).trip === "object" &&
          (item as QueuedMutation).trip !== null,
      );
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function loadQueue(): Promise<QueuedMutation[]> {
  try {
    const raw = await getDataStore().getItem(QUEUE_KEY);
    return readQueue(raw);
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedMutation[]): Promise<void> {
  try {
    await getDataStore().setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

export async function enqueue(tripId: string, trip: Trip, revision?: number): Promise<void> {
  const queue = await loadQueue();
  queue.push({ tripId, trip, revision, timestamp: new Date().toISOString() });
  await saveQueue(queue);
}

export async function dequeue(tripId: string, timestamp: string): Promise<void> {
  const queue = await loadQueue();
  const next = queue.filter((item) => !(item.tripId === tripId && item.timestamp === timestamp));
  await saveQueue(next);
}

export async function hasQueued(tripId: string): Promise<boolean> {
  const queue = await loadQueue();
  return queue.some((item) => item.tripId === tripId);
}

/**
 * Sends queued snapshots in order. Returns the trips whose queued edits were
 * dropped because the server copy had changed, so the caller can tell the user.
 */
export async function flushQueue(): Promise<string[]> {
  const queue = await loadQueue();
  const conflicts: string[] = [];
  const savedRevisions = new Map<string, number>();
  for (const item of queue) {
    if (conflicts.includes(item.tripId)) {
      continue;
    }
    try {
      // Later snapshots of a trip were made on top of earlier queued ones, so
      // each goes out on the revision the previous one created.
      const saved = await saveTrip(item.tripId, item.trip, savedRevisions.get(item.tripId) ?? item.revision);
      if (saved.revision !== undefined) {
        savedRevisions.set(item.tripId, saved.revision);
      }
      await dequeue(item.tripId, item.timestamp);
    } catch (caught) {
      // Network failure: everything behind this would fail too — retry later.
      if (caught instanceof TypeError) {
        break;
      }
      // Retrying a stale snapshot can never succeed and would overwrite newer
      // data if it did, so every queued edit for this trip goes.
      if (caught instanceof TripConflictError) {
        conflicts.push(item.tripId);
        await saveQueue((await loadQueue()).filter((queued) => queued.tripId !== item.tripId));
        continue;
      }
      // A permanent failure (e.g. trip deleted remotely, validation error)
      // must not block the rest of the queue forever. Retry a few times,
      // then drop it so later mutations can sync.
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await dequeue(item.tripId, item.timestamp);
      } else {
        const next = (await loadQueue()).map((queued) =>
          queued.tripId === item.tripId && queued.timestamp === item.timestamp
            ? { ...queued, attempts }
            : queued,
        );
        await saveQueue(next);
      }
    }
  }
  return conflicts;
}
