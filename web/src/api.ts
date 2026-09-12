import { createExampleTrip, createTripFromTemplate, type Trip } from "@fairshare/domain";
import type { PhotoRecord } from "@fairshare/domain/photos";
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

export async function createRemoteDemoTrip(name: string): Promise<{
  id: string;
  trip: PublicTrip;
  pin: string;
  photos_token: string;
}> {
  const created = await createRemoteTrip(name);
  const trip = createExampleTrip(name);
  const saved = await saveTrip(created.id, trip);
  return {
    id: created.id,
    trip: saved,
    pin: created.pin,
    photos_token: created.photos_token,
  };
}

export async function createRemoteTemplateTrip(
  templateId: string,
  name?: string,
): Promise<{ id: string; trip: PublicTrip; pin: string; photos_token: string }> {
  const trip = createTripFromTemplate(templateId, name);
  const created = await createRemoteTrip(trip.name);
  const saved = await saveTrip(created.id, trip);
  return {
    id: created.id,
    trip: saved,
    pin: created.pin,
    photos_token: created.photos_token,
  };
}

export async function deleteRemoteTrip(id: string): Promise<void> {
  const res = await fetch(`/api/trips/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
}

export async function saveTrip(id: string, trip: PublicTrip): Promise<PublicTrip> {
  const res = await fetch(`/api/trips/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: trip.schema_version,
      name: trip.name,
      people: trip.people,
      archivedAt: trip.archivedAt,
      currency: trip.currency,
      expenses: trip.expenses.map((expense) => ({
        id: expense.id,
        description: expense.description,
        payer: expense.payer,
        amount_cents: expense.amount_cents,
        participants: expense.participants,
        ...(expense.weights === undefined ? {} : { weights: expense.weights }),
        ...(expense.date === undefined ? {} : { date: expense.date }),
        ...(expense.category === undefined ? {} : { category: expense.category }),
        ...(expense.note === undefined ? {} : { note: expense.note }),
        ...(expense.currency === undefined ? {} : { currency: expense.currency }),
        ...(expense.exchange_rate === undefined ? {} : { exchange_rate: expense.exchange_rate }),
        ...(expense.tax_cents === undefined ? {} : { tax_cents: expense.tax_cents }),
        ...(expense.tip_cents === undefined ? {} : { tip_cents: expense.tip_cents }),
      })),
      completedPayments: trip.completedPayments,
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
  const body = (await res.json()) as { photos?: PhotoRecord[] };
  return body.photos ?? [];
}

export async function uploadPhoto(
  tripId: string,
  jpeg: Blob,
  extras?: { photoId?: string; original?: Blob },
): Promise<PhotoRecord> {
  const data = new FormData();
  data.append("photo", new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
  if (extras?.photoId) {
    data.append("photo_id", extras.photoId);
  }
  if (extras?.original) {
    data.append("original", new File([extras.original], "original.jpg", { type: "image/jpeg" }));
  }
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

export async function deletePhoto(tripId: string, photoId: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/photos/${photoId}`, {
    method: "DELETE",
    headers: authHeaders(tripId),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
}

export async function lockTripPhotos(
  tripId: string,
  pin?: string,
): Promise<{ pin: string; photos_token: string }> {
  const res = await fetch(`/api/trips/${tripId}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pin ? { pin } : {}),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as { pin?: unknown; photos_token?: unknown };
  if (typeof body.pin !== "string" || typeof body.photos_token !== "string") {
    throw new Error("Could not set photos PIN");
  }
  return { pin: body.pin, photos_token: body.photos_token };
}

// Cloudinary signed original uploads were removed in the Cloudflare migration.
// Originals now upload through the same Worker endpoint as display copies.
