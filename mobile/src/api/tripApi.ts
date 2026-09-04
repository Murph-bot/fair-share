import { parseTrip, type Trip } from "../domain";
import type { PublicTrip } from "../domain/photos";

import { apiUrl, readError } from "./client";

function asPublicTrip(raw: unknown): PublicTrip {
  const trip = parseTrip(raw);
  const photosLocked =
    typeof raw === "object" && raw !== null && (raw as { photos_locked?: unknown }).photos_locked === true;
  return { ...trip, photos_locked: photosLocked };
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

type TripPayload = Pick<Trip, "schema_version" | "name" | "people" | "expenses">;

function tripPayload(trip: Trip): TripPayload {
  return {
    schema_version: trip.schema_version,
    name: trip.name,
    people: [...trip.people],
    expenses: trip.expenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      payer: expense.payer,
      amount_cents: expense.amount_cents,
      participants: [...expense.participants],
      ...(expense.weights === undefined ? {} : { weights: [...expense.weights] }),
    })),
  };
}

export async function saveTrip(tripId: string, trip: Trip): Promise<PublicTrip> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}`), {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tripPayload(trip)),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return asPublicTrip(await response.json());
}
