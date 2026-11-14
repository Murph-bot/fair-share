import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTrip, saveTrip, TripConflictError } from "../api/tripApi";
import { enqueue, flushQueue, hasQueued } from "../api/mutationQueue";
import { isOnline } from "../api/networkStatus";
import { saveRecentTrip } from "../api/recentTrips";
import { getDataStore } from "../api/storage";
import type { Trip } from "../domain";
import type { PublicTrip } from "../domain/photos";

export type UseTripResult = {
  trip: PublicTrip | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  queued: boolean;
  offline: boolean;
  reload: () => Promise<void>;
  mutate: (transform: (trip: Trip) => Trip) => Promise<boolean>;
  flush: () => Promise<void>;
};

const OFFLINE_CONFLICT_MESSAGE =
  "This trip was changed by someone else while you were offline. Your offline changes were not saved.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function snapshotKey(tripId: string): string {
  return `fairshare.trip.snapshot.${tripId}`;
}

async function saveSnapshot(tripId: string, trip: PublicTrip): Promise<void> {
  try {
    await getDataStore().setItem(snapshotKey(tripId), JSON.stringify(trip));
  } catch {
    /* snapshots are optional */
  }
}

async function loadSnapshot(tripId: string): Promise<PublicTrip | null> {
  try {
    const raw = await getDataStore().getItem(snapshotKey(tripId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as PublicTrip) : null;
  } catch {
    return null;
  }
}

export function useTrip(tripId: string | null): UseTripResult {
  const [trip, setTrip] = useState<PublicTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tripRef = useRef<PublicTrip | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);

  const reload = useCallback(async () => {
    if (!tripId) {
      setTrip(null);
      setLoading(false);
      setError("Missing trip id");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const conflicts = await flushQueue();
      setQueued(await hasQueued(tripId));
      const nextTrip = await fetchTrip(tripId);
      tripRef.current = nextTrip;
      setTrip(nextTrip);
      setOffline(false);
      if (conflicts.includes(tripId)) {
        setError(OFFLINE_CONFLICT_MESSAGE);
      }
      void saveSnapshot(tripId, nextTrip);
      void saveRecentTrip(tripId, nextTrip.name);
    } catch (caught) {
      const snapshot = await loadSnapshot(tripId);
      if (snapshot) {
        tripRef.current = snapshot;
        setTrip(snapshot);
        setOffline(true);
        setError(null);
      } else {
        setError(errorMessage(caught));
        setTrip(null);
      }
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mutate = useCallback(
    async (transform: (current: Trip) => Trip) => {
      if (!tripId) {
        setError("Missing trip id");
        return false;
      }
      if (savingRef.current) {
        return false;
      }

      const current = tripRef.current;
      if (!current) {
        setError("Trip is not loaded yet");
        return false;
      }

      setSaving(true);
      savingRef.current = true;
      setError(null);
      setQueued(false);
      const keepOffline = async (nextTrip: Trip): Promise<void> => {
        const local: PublicTrip = {
          ...nextTrip,
          photos_locked: current.photos_locked,
          revision: current.revision,
        };
        await enqueue(tripId, nextTrip, current.revision);
        tripRef.current = local;
        setTrip(local);
        setQueued(true);
        setOffline(true);
        void saveSnapshot(tripId, local);
      };
      try {
        const nextTrip = transform(current);
        const online = await isOnline();
        if (!online) {
          await keepOffline(nextTrip);
          return true;
        }
        try {
          const savedTrip = await saveTrip(tripId, nextTrip, current.revision);
          tripRef.current = savedTrip;
          setTrip(savedTrip);
          setOffline(false);
          void saveSnapshot(tripId, savedTrip);
          return true;
        } catch (caught) {
          if (caught instanceof TripConflictError) {
            // Show the newer copy. The user redoes the edit on top of it.
            tripRef.current = caught.latest;
            setTrip(caught.latest);
            void saveSnapshot(tripId, caught.latest);
            throw caught;
          }
          // A failed request (e.g. connectivity dropped between the online
          // check and the call) queues the edit like an offline mutation.
          // Server rejections (4xx/5xx) surface as errors instead.
          if (!(caught instanceof TypeError)) {
            throw caught;
          }
          await keepOffline(nextTrip);
          return true;
        }
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [tripId],
  );

  const flush = useCallback(async () => {
    try {
      setSaving(true);
      const conflicts = await flushQueue();
      setQueued(await hasQueued(tripId ?? ""));
      await reload();
      if (tripId && conflicts.includes(tripId)) {
        setError(OFFLINE_CONFLICT_MESSAGE);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [tripId, reload]);

  return {
    trip,
    loading,
    saving,
    error,
    queued,
    offline,
    reload,
    mutate,
    flush,
  };
}
