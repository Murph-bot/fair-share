import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTrip, saveTrip } from "../api/tripApi";
import { enqueue, flushQueue, hasQueued } from "../api/mutationQueue";
import { isOnline } from "../api/networkStatus";
import { saveRecentTrip } from "../api/recentTrips";
import type { Trip } from "../domain";
import type { PublicTrip } from "../domain/photos";

export type UseTripResult = {
  trip: PublicTrip | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  queued: boolean;
  reload: () => Promise<void>;
  mutate: (transform: (trip: Trip) => Trip) => Promise<boolean>;
  flush: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function useTrip(tripId: string | null): UseTripResult {
  const [trip, setTrip] = useState<PublicTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
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
      await flushQueue();
      setQueued(await hasQueued(tripId));
      const nextTrip = await fetchTrip(tripId);
      tripRef.current = nextTrip;
      setTrip(nextTrip);
      void saveRecentTrip(tripId, nextTrip.name);
    } catch (caught) {
      setError(errorMessage(caught));
      setTrip(null);
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
      try {
        const nextTrip = transform(current);
        const online = await isOnline();
        if (!online) {
          await enqueue(tripId, nextTrip);
          tripRef.current = nextTrip as PublicTrip;
          setTrip(nextTrip as PublicTrip);
          setQueued(true);
          return true;
        }
        const savedTrip = await saveTrip(tripId, nextTrip);
        tripRef.current = savedTrip;
        setTrip(savedTrip);
        return true;
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
      await flushQueue();
      setQueued(await hasQueued(tripId ?? ""));
      await reload();
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
    reload,
    mutate,
    flush,
  };
}
