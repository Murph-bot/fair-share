import { afterEach, describe, expect, it, vi } from "vitest";
import { addExpense, addPerson, createTrip, type Trip } from "@fairshare/domain/trip";
import { saveEdit, type PublicTrip } from "../src/api";

const tripId = "33333333333333333333333333333333";

function withExpense(trip: Trip, description: string): Trip {
  return addExpense(
    trip,
    { description, payer: "Alice", amount_cents: 1000, participants: ["Alice", "Bob"] },
    `id-${description}`,
  );
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Trip & { revision?: number }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

const base: PublicTrip = {
  ...addPerson(addPerson(createTrip("Crete"), "Alice"), "Bob"),
  photos_locked: false,
  revision: 3,
};
const addTaxi = (trip: Trip): Trip => withExpense(trip, "Taxi");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveEdit", () => {
  it("sends the revision the trip was loaded at", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { ...addTaxi(base), revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEdit(tripId, base, addTaxi);
    expect(result.rebased).toBe(false);
    expect(result.trip.revision).toBe(4);
    expect(sentBodies(fetchMock)[0]?.revision).toBe(3);
  });

  it("re-applies the edit on the newer copy after a 409 instead of overwriting it", async () => {
    const theirs = { ...withExpense(base, "Dinner"), photos_locked: false, revision: 4 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(409, { error: "changed", trip: theirs }))
      .mockResolvedValueOnce(reply(200, { ...addTaxi(theirs), revision: 5 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEdit(tripId, base, addTaxi);
    expect(result.rebased).toBe(true);
    const retry = sentBodies(fetchMock)[1];
    expect(retry?.revision).toBe(4);
    expect(retry?.expenses.map((e) => e.description)).toEqual(["Dinner", "Taxi"]);
  });

  it("tells the user when the edit cannot be re-applied", async () => {
    const theirs = { ...createTrip("Crete"), photos_locked: false, revision: 4 };
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(409, { error: "changed", trip: theirs }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveEdit(tripId, base, addTaxi)).rejects.toThrow(/changed by someone else/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
