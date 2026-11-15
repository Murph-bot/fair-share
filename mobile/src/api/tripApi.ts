import { createExampleTrip, parseTrip, type Trip } from "../domain";
import type { PublicTrip } from "../domain/photos";

import { apiUrl, readError } from "./client";

/** The trip on the server is newer than the copy this save was made from. */
export class TripConflictError extends Error {
  constructor(readonly latest: PublicTrip) {
    super("This trip was changed by someone else. Your last change was not saved.");
    this.name = "TripConflictError";
  }
}

function asPublicTrip(raw: unknown): PublicTrip {
  const trip = parseTrip(raw);
  const extras = (typeof raw === "object" && raw !== null ? raw : {}) as {
    photos_locked?: unknown;
    revision?: unknown;
  };
  return {
    ...trip,
    photos_locked: extras.photos_locked === true,
    ...(typeof extras.revision === "number" ? { revision: extras.revision } : {}),
  };
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

export async function deleteRemoteTrip(tripId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function saveTrip(tripId: string, trip: Trip, revision?: number): Promise<PublicTrip> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...tripPayload(trip), ...(revision === undefined ? {} : { revision }) }),
  });

  if (response.status === 409) {
    const body = (await response.json()) as { trip?: unknown };
    throw new TripConflictError(asPublicTrip(body.trip));
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }

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
  const saved = await saveTrip(created.id, trip, created.trip.revision);
  return {
    id: created.id,
    trip: saved,
    pin: created.pin,
    photos_token: created.photos_token,
  };
}
