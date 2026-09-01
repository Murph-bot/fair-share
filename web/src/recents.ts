const KEY = "fairshare.recents";
const LIMIT = 8;

export type RecentTrip = { id: string; name: string };

export function loadRecents(): RecentTrip[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is RecentTrip =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentTrip).id === "string" &&
        typeof (item as RecentTrip).name === "string",
    );
  } catch {
    return [];
  }
}

export function rememberRecent(id: string, name: string): void {
  try {
    const next = [{ id, name }, ...loadRecents().filter((item) => item.id !== id)].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — recents are optional */
  }
}
