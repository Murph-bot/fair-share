import { createExampleTrip, parseTrip, type Trip } from "../domain";
import type { PublicTrip } from "../domain/photos";

import { apiUrl, readError } from "./client";
import { loadPhotoToken } from "./photoSession";
import { getDataStore } from "./storage";

export class ConflictError extends Error {}

// Last revision (ETag) seen per trip; queued mutations carry it along so a
// stale offline edit can be merged instead of silently overwriting
// whatever changed on the server while the phone was offline. Persisted
// alongside the in-memory cache so it survives an app restart — without
// that, a restart while offline would lose the rev and fall back to a
// blind overwrite.
const tripRevs = new Map<string, string>();

function revKey(tripId: string): string {
  return `fairshare.trip.rev.${tripId}`;
}

async function rememberRev(tripId: string, response: Response): Promise<void> {
  const etag = response.headers.get("ETag");
  if (!etag) {
    return;
  }
  tripRevs.set(tripId, etag);
  try {
    await getDataStore().setItem(revKey(tripId), etag);
  } catch {
    /* best effort */
  }
}

export async function getKnownRev(tripId: string): Promise<string | undefined> {
  const cached = tripRevs.get(tripId);
  if (cached) {
    return cached;
  }
  try {
    const stored = await getDataStore().getItem(revKey(tripId));
    if (stored) {
      tripRevs.set(tripId, stored);
      return stored;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function asPublicTrip(raw: unknown): PublicTrip {
  const trip = parseTrip(raw);
  const photosLocked =
    typeof raw === "object" && raw !== null && (raw as { photos_locked?: unknown }).photos_locked === true;
  return { ...trip, photos_locked: photosLocked };
}

export async function createRemoteTrip(name: string): Promise<{
  id: string;
  trip: PublicTrip;
  pin: string;
  photos_token: string;
}> {
  const response = await fetch(apiUrl("/api/trips"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const body = (await response.json()) as {
    id: string;
    trip: unknown;
    pin: string;
    photos_token: string;
  };

  return {
    id: body.id,
    trip: asPublicTrip(body.trip),
    pin: body.pin,
    photos_token: body.photos_token,
  };
}

export async function fetchTrip(tripId: string): Promise<PublicTrip> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  await rememberRev(tripId, response);
  return asPublicTrip(await response.json());
}

type TripPayload = Pick<
  Trip,
  "schema_version" | "name" | "people" | "expenses" | "completedPayments" | "archivedAt" | "currency"
>;

function tripPayload(trip: Trip): TripPayload {
  return {
    schema_version: trip.schema_version,
    name: trip.name,
    people: [...trip.people],
    archivedAt: trip.archivedAt,
    currency: trip.currency,
    expenses: trip.expenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      payer: expense.payer,
      amount_cents: expense.amount_cents,
      participants: [...expense.participants],
      ...(expense.weights === undefined ? {} : { weights: [...expense.weights] }),
      ...(expense.date === undefined ? {} : { date: expense.date }),
      ...(expense.category === undefined ? {} : { category: expense.category }),
      ...(expense.note === undefined ? {} : { note: expense.note }),
      ...(expense.currency === undefined ? {} : { currency: expense.currency }),
      ...(expense.exchange_rate === undefined ? {} : { exchange_rate: expense.exchange_rate }),
      ...(expense.tax_cents === undefined ? {} : { tax_cents: expense.tax_cents }),
      ...(expense.tip_cents === undefined ? {} : { tip_cents: expense.tip_cents }),
    })),
    completedPayments: trip.completedPayments ? [...trip.completedPayments] : undefined,
  };
}

async function photoAuthHeader(tripId: string): Promise<Record<string, string>> {
  const token = await loadPhotoToken(tripId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function deleteRemoteTrip(tripId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      ...(await photoAuthHeader(tripId)),
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function saveTrip(tripId: string, trip: Trip, options?: { ifMatch?: string }): Promise<PublicTrip> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options?.ifMatch ? { "If-Match": options.ifMatch } : {}),
    },
    body: JSON.stringify(tripPayload(trip)),
  });

  if (!response.ok) {
    const message = await readError(response);
    if (response.status === 409) {
      throw new ConflictError(message);
    }
    throw new Error(message);
  }

  await rememberRev(tripId, response);
  return asPublicTrip(await response.json());
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
