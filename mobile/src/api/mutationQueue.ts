import { getDataStore } from "./storage";
import { ConflictError, fetchTrip, getKnownRev, saveTrip } from "./tripApi";
import { mergeTrips } from "./tripMerge";
import type { Trip } from "../domain";

const QUEUE_KEY = "fairshare.mutation.queue";

const MAX_ATTEMPTS = 5;

export type QueuedMutation = {
  tripId: string;
  trip: Trip;
  timestamp: string;
  attempts?: number;
  // The trip (and its server revision) this edit was made on top of. Used to
  // merge with whatever changed remotely while the device was offline.
  // Missing for older queued items, which fall back to the pre-ETag
  // behavior of overwriting whatever is on the server.
  baseTrip?: Trip;
  baseRev?: string;
  // Set when a merge found the same item changed differently on both sides.
  // Conflicted items are kept (not dropped by MAX_ATTEMPTS) and surfaced to
  // the UI instead of being auto-resolved.
  conflict?: boolean;
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

export async function enqueue(
  tripId: string,
  trip: Trip,
  base?: { trip: Trip; rev?: string },
): Promise<void> {
  const queue = await loadQueue();
  queue.push({
    tripId,
    trip,
    timestamp: new Date().toISOString(),
    ...(base ? { baseTrip: base.trip, baseRev: base.rev } : {}),
  });
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

export async function hasConflict(tripId: string): Promise<boolean> {
  const queue = await loadQueue();
  return queue.some((item) => item.tripId === tripId && item.conflict);
}

async function updateQueueItem(
  tripId: string,
  timestamp: string,
  update: (item: QueuedMutation) => QueuedMutation,
): Promise<void> {
  const queue = await loadQueue();
  const next = queue.map((queued) =>
    queued.tripId === tripId && queued.timestamp === timestamp ? update(queued) : queued,
  );
  await saveQueue(next);
}

// Resolves a 409 by fetching the latest remote trip and three-way merging it
// with the edit's base and local state. A clean merge is saved immediately;
// a true conflict (same item changed differently on both sides) is left in
// the queue, flagged, rather than guessing which side should win.
async function resolveConflict(item: QueuedMutation): Promise<"resolved" | "conflict" | "error"> {
  try {
    const remote = await fetchTrip(item.tripId);
    const base = item.baseTrip ?? remote;
    const { trip: merged, conflict } = mergeTrips(base, item.trip, remote);
    if (conflict) {
      return "conflict";
    }
    const rev = getKnownRev(item.tripId);
    await saveTrip(item.tripId, merged, rev ? { ifMatch: rev } : undefined);
    return "resolved";
  } catch {
    return "error";
  }
}

export async function flushQueue(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    return;
  }
  for (const item of queue) {
    if (item.conflict) {
      continue;
    }
    try {
      await saveTrip(item.tripId, item.trip, item.baseRev ? { ifMatch: item.baseRev } : undefined);
      await dequeue(item.tripId, item.timestamp);
    } catch (caught) {
      // Network failure: everything behind this would fail too — retry later.
      if (caught instanceof TypeError) {
        break;
      }
      if (caught instanceof ConflictError) {
        const outcome = await resolveConflict(item);
        if (outcome === "resolved") {
          await dequeue(item.tripId, item.timestamp);
        } else if (outcome === "conflict") {
          await updateQueueItem(item.tripId, item.timestamp, (queued) => ({ ...queued, conflict: true }));
        }
        // "error" (e.g. the re-fetch failed): leave attempts untouched and
        // retry on the next flush.
        continue;
      }
      // A permanent failure (e.g. trip deleted remotely, validation error)
      // must not block the rest of the queue forever. Retry a few times,
      // then drop it so later mutations can sync.
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await dequeue(item.tripId, item.timestamp);
      } else {
        await updateQueueItem(item.tripId, item.timestamp, (queued) => ({ ...queued, attempts }));
      }
    }
  }
}
