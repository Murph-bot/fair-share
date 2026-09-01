import type { Trip } from "./domain";

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error) {
      return body.error;
    }
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

export async function createRemoteTrip(name: string): Promise<{ id: string; trip: Trip }> {
  const res = await fetch("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as { id: string; trip: Trip };
}

export async function fetchTrip(id: string): Promise<Trip> {
  const res = await fetch(`/api/trips/${id}`);
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as Trip;
}

export async function saveTrip(id: string, trip: Trip): Promise<Trip> {
  const res = await fetch(`/api/trips/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trip),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as Trip;
}
