import { getDataStore } from "./storage";
import { ConflictError, fetchTrip, getKnownRev, saveTrip } from "./tripApi";
import { mergeTrips, type TripConflict } from "./tripMerge";
import type { Trip } from "../domain";

const QUEUE_KEY = "fairshare.mutation.queue";

const MAX_ATTEMPTS = 5;
// How many times to re-fetch-and-remerge if the merged save itself races
// with another write (back-to-back 409s), before giving up for this flush.
const MAX_CONFLICT_RETRIES = 3;

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
};

export type ConflictNotice = {
  tripId: string;
  timestamp: string;
  discarded: TripConflict[];
};

function conflictKey(tripId: string): string {
  return `fairshare.trip.conflict.${tripId}`;
}

export async function recordConflictNotice(tripId: string, discarded: TripConflict[]): Promise<void> {
  if (discarded.length === 0) {
    return;
  }
  const notice: ConflictNotice = { tripId, timestamp: new Date().toISOString(), discarded };
  try {
    await getDataStore().setItem(conflictKey(tripId), JSON.stringify(notice));
  } catch {
    /* best effort */
  }
}

export async function loadConflictNotice(tripId: string): Promise<ConflictNotice | null> {
  try {
    const raw = await getDataStore().getItem(conflictKey(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as ConflictNotice) : null;
  } catch {
    return null;
  }
}

export async function clearConflictNotice(tripId: string): Promise<void> {
  try {
    await getDataStore().removeItem(conflictKey(tripId));
  } catch {
    /* ignore */
  }
}

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

async function ifMatchFor(tripId: string): Promise<{ ifMatch: string } | undefined> {
  const rev = await getKnownRev(tripId);
  return rev ? { ifMatch: rev } : undefined;
}

// Fetches the latest remote trip and three-way merges it with the edit's
// base and local state, then saves the result. A clean merge (or one with
// true conflicts, where the remote value wins for the conflicting items) is
// saved in the same pass — nothing is left half-applied. Returns false only
// if the save keeps racing with other writers past MAX_CONFLICT_RETRIES, or
// if resolving requires network access that isn't there right now; in both
// cases the item stays queued untouched, to retry on the next flush.
async function mergeAndSave(item: QueuedMutation): Promise<boolean> {
  const base = item.baseTrip;
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const remote = await fetchTrip(item.tripId);
    if (!base) {
      await saveTrip(item.tripId, item.trip, await ifMatchFor(item.tripId));
      return true;
    }
    const { trip: merged, conflicts } = mergeTrips(base, item.trip, remote);
    try {
      await saveTrip(item.tripId, merged, await ifMatchFor(item.tripId));
    } catch (caught) {
      if (caught instanceof ConflictError) {
        continue; // someone else wrote again meanwhile; refetch and remerge
      }
      throw caught;
    }
    await recordConflictNotice(item.tripId, conflicts);
    return true;
  }
  return false;
}

export async function flushQueue(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) {
    return;
  }
  for (const item of queue) {
    try {
      if (item.baseTrip && !item.baseRev) {
        // No known revision for this edit (e.g. the app restarted offline
        // and lost the in-memory rev cache before this item could record
        // one): merge against the latest remote instead of overwriting it.
        const resolved = await mergeAndSave(item);
        if (resolved) {
          await dequeue(item.tripId, item.timestamp);
        }
        continue;
      }

      await saveTrip(item.tripId, item.trip, item.baseRev ? { ifMatch: item.baseRev } : undefined);
      await dequeue(item.tripId, item.timestamp);
    } catch (caught) {
      // Network failure: everything behind this would fail too — retry later.
      if (caught instanceof TypeError) {
        break;
      }
      if (caught instanceof ConflictError) {
        const resolved = await mergeAndSave(item);
        if (resolved) {
          await dequeue(item.tripId, item.timestamp);
        }
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
