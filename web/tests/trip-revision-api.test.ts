import { beforeEach, describe, expect, it } from "vitest";
import { addExpense, addPerson, createTrip, type Trip } from "@fairshare/domain/trip";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "22222222222222222222222222222222";
const url = `https://example.com/api/trips/${tripId}`;

type TripBody = Trip & { revision: number; photos_locked: boolean };

function withExpense(trip: Trip, description: string): Trip {
  return addExpense(
    trip,
    { description, payer: "Alice", amount_cents: 1000, participants: ["Alice", "Bob"] },
    `id-${description}`,
  );
}

function put(body: unknown): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("trip revisions", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let base: Trip;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    base = addPerson(addPerson(createTrip("Crete"), "Alice"), "Bob");
    trips.set(tripId, base);
  });

  it("returns the revision on read", async () => {
    const res = await handleApiRequest(new Request(url), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TripBody).revision).toBe(0);
  });

  it("saves with the current revision and bumps it", async () => {
    const res = await handleApiRequest(put({ ...withExpense(base, "Dinner"), revision: 0 }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TripBody).revision).toBe(1);

    const read = (await (await handleApiRequest(new Request(url), env)).json()) as TripBody;
    expect(read.revision).toBe(1);
    expect(read.expenses.map((e) => e.description)).toEqual(["Dinner"]);
  });

  it("rejects the second of two saves from the same revision and keeps the first", async () => {
    const first = await handleApiRequest(put({ ...withExpense(base, "Dinner"), revision: 0 }), env);
    expect(first.status).toBe(200);

    const second = await handleApiRequest(put({ ...withExpense(base, "Taxi"), revision: 0 }), env);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; trip: TripBody };
    expect(body.trip.revision).toBe(1);
    expect(body.trip.expenses.map((e) => e.description)).toEqual(["Dinner"]);

    const stored = trips.get(tripId) as Trip;
    expect(stored.expenses.map((e) => e.description)).toEqual(["Dinner"]);
  });

  it("accepts a save without a revision only while the trip is at revision 0", async () => {
    const legacy = await handleApiRequest(put(withExpense(base, "Dinner")), env);
    expect(legacy.status).toBe(200);
    expect(((await legacy.json()) as TripBody).revision).toBe(1);

    const stale = await handleApiRequest(put(withExpense(base, "Taxi")), env);
    expect(stale.status).toBe(409);
    expect((trips.get(tripId) as Trip).expenses.map((e) => e.description)).toEqual(["Dinner"]);
  });

  it("rejects a malformed revision", async () => {
    const res = await handleApiRequest(put({ ...base, revision: "1" }), env);
    expect(res.status).toBe(400);
  });

  it("returns 404 when saving a trip that does not exist", async () => {
    trips.delete(tripId);
    const res = await handleApiRequest(put({ ...base, revision: 0 }), env);
    expect(res.status).toBe(404);
  });

  it("keeps the photo PIN when a save races with locking photos", async () => {
    const lock = await handleApiRequest(
      new Request(`${url}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "112233" }),
      }),
      env,
    );
    expect(lock.status).toBe(200);

    const res = await handleApiRequest(put({ ...withExpense(base, "Dinner"), revision: 0 }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TripBody).photos_locked).toBe(true);
    expect(typeof (trips.get(tripId) as { pin_hash?: unknown }).pin_hash).toBe("string");
  });

  it("starts new trips at revision 0", async () => {
    const res = await handleApiRequest(
      new Request("https://example.com/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { trip: TripBody }).trip.revision).toBe(0);
  });
});
