import { getStore } from "./storage";
import { saveTrip } from "./tripApi";
import type { Trip } from "../domain";

const QUEUE_KEY = "fairshare.mutation.queue";

const MAX_ATTEMPTS = 5;

export type QueuedMutation = {
  tripId: string;
  trip: Trip;
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
    const raw = await getStore().getItem(QUEUE_KEY);
    return readQueue(raw);
  } catch {
    return [];
  }
}

export async function saveQueue(queue: QueuedMutation[]): Promise<void> {
  try {
    await getStore().setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

export async function enqueue(tripId: string, trip: Trip): Promise<void> {
  const queue = await loadQueue();
  queue.push({ tripId, trip, timestamp: new Date().toISOString() });
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

export async function flushQueue(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    return;
  }
  for (const item of queue) {
    try {
      await saveTrip(item.tripId, item.trip);
      await dequeue(item.tripId, item.timestamp);
    } catch (caught) {
      // Network failure: everything behind this would fail too — retry later.
      if (caught instanceof TypeError) {
        break;
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
}
