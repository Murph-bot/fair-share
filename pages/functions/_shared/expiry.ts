import { TRIP_RETENTION_MS } from "../../../packages/domain/src/photos";
import { pruneRateLimits } from "./rateLimit";
import { deleteAllTripPhotos, deleteTripRow, listTripIdsNotChangedSince } from "./stores";
import type { Env } from "./env";

// Each trip costs a few D1/R2 calls, and a Pages Function has a subrequest cap
// per request, so a purge handles a small batch and reports whether more remain.
export const PURGE_BATCH_SIZE = 10;

export type PurgeResult = { deleted: number; more: boolean };

/**
 * Deletes trips not changed for TRIP_RETENTION_MS, photos first. A trip row goes
 * only after its photos are gone, so a failed run leaves it for the next one.
 */
export async function purgeExpiredTrips(env: Env, now = Date.now()): Promise<PurgeResult> {
  const cutoff = new Date(now - TRIP_RETENTION_MS).toISOString();
  // Counters hold client IPs and are normally pruned when a new window opens;
  // this makes sure none outlive their window on a quiet site.
  await pruneRateLimits(env);
  const ids = await listTripIdsNotChangedSince(env, cutoff, PURGE_BATCH_SIZE);
  for (const id of ids) {
    await deleteAllTripPhotos(env, id);
    await deleteTripRow(env, id);
  }
  return { deleted: ids.length, more: ids.length === PURGE_BATCH_SIZE };
}
