import { getStore } from "./storage";

const RECENT_TRIPS_KEY = "fairshare.recent.trips";
const MAX_RECENTS = 10;

export type RecentTrip = {
  id: string;
  name: string;
  openedAt: string;
};

function readRecents(raw: string | null): RecentTrip[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is RecentTrip =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as RecentTrip).id === "string" &&
          typeof (item as RecentTrip).name === "string" &&
          typeof (item as RecentTrip).openedAt === "string",
      );
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function loadRecentTrips(): Promise<RecentTrip[]> {
  try {
    const raw = await getStore().getItem(RECENT_TRIPS_KEY);
    return readRecents(raw);
  } catch {
    return [];
  }
}

export async function saveRecentTrip(id: string, name: string): Promise<void> {
  try {
    const recents = await loadRecentTrips();
    const next = recents.filter((trip) => trip.id !== id);
    next.unshift({ id, name, openedAt: new Date().toISOString() });
    if (next.length > MAX_RECENTS) {
      next.length = MAX_RECENTS;
    }
    await getStore().setItem(RECENT_TRIPS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function removeRecentTrip(id: string): Promise<void> {
  try {
    const recents = await loadRecentTrips();
    const next = recents.filter((trip) => trip.id !== id);
    await getStore().setItem(RECENT_TRIPS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
