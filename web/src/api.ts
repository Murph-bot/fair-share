import type { Trip } from "./domain";
import type { PhotoRecord } from "./domain/photos";
import { loadPhotoToken } from "./photo-session";

export type PublicTrip = Trip & { photos_locked?: boolean };

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

function authHeaders(tripId: string): HeadersInit {
  const token = loadPhotoToken(tripId);
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

export async function createRemoteTrip(name: string): Promise<{
  id: string;
  trip: PublicTrip;
  pin: string;
  photos_token: string;
}> {
  const res = await fetch("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as {
    id: string;
    trip: PublicTrip;
    pin?: unknown;
    photos_token?: unknown;
  };
  if (typeof body.id !== "string" || typeof body.pin !== "string" || typeof body.photos_token !== "string") {
    throw new Error("Could not create trip");
  }
  return { id: body.id, trip: body.trip, pin: body.pin, photos_token: body.photos_token };
}

export async function fetchTrip(id: string): Promise<PublicTrip> {
  const res = await fetch(`/api/trips/${id}`);
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as PublicTrip;
}

export async function saveTrip(id: string, trip: PublicTrip): Promise<PublicTrip> {
  const res = await fetch(`/api/trips/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: trip.schema_version,
      name: trip.name,
      people: trip.people,
      expenses: trip.expenses,
    }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as PublicTrip;
}

export async function unlockPhotos(tripId: string, pin: string): Promise<string> {
  const res = await fetch(`/api/trips/${tripId}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    throw new Error("Could not unlock photos");
  }
  return body.token;
}

export async function fetchPhotos(tripId: string): Promise<PhotoRecord[]> {
  const res = await fetch(`/api/trips/${tripId}/photos`, {
    headers: authHeaders(tripId),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as { photos: PhotoRecord[] };
  return body.photos;
}

export async function uploadPhoto(tripId: string, jpeg: Blob): Promise<PhotoRecord> {
  const data = new FormData();
  data.append("photo", new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
  const res = await fetch(`/api/trips/${tripId}/photos`, {
    method: "POST",
    headers: authHeaders(tripId),
    body: data,
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as { photo: PhotoRecord };
  return body.photo;
}
