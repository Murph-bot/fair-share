import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDataStorage, configureStorage, memoryTokenStore } from "../src/api/storage";
import { addExpense, addPerson, createTrip, type Trip } from "../src/domain";
import { enqueue, flushQueue, loadQueue } from "../src/api/mutationQueue";

const tripId = "ff4765be974564a2503e8f94f67538dd";

function jsonResponse(trip: Trip, rev: number, status = 200) {
  return new Response(JSON.stringify({ ...trip, photos_locked: false }), {
    status,
    headers: { ETag: `"${rev}"` },
  });
}

function errorResponse(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status });
}

beforeEach(() => {
  configureStorage(memoryTokenStore());
  configureDataStorage(memoryTokenStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mutationQueue conflict resolution", () => {
  it("merges a remotely-added expense instead of dropping it on a 409", async () => {
    // The phone fetched this trip (rev 1) before going offline...
    const base = addPerson(addPerson(createTrip("Ski trip"), "Alice"), "Bob");
    // ...then added an expense while offline.
    const local = addExpense(
      base,
      { description: "Lift tickets", payer: "Alice", amount_cents: 5000, participants: ["Alice", "Bob"] },
      "local-expense",
    );
    // Meanwhile someone else added a different expense remotely, bumping the rev.
    const remote = addExpense(
      base,
      { description: "Rental car", payer: "Bob", amount_cents: 8000, participants: ["Alice", "Bob"] },
      "remote-expense",
    );

    await enqueue(tripId, local, { trip: base, rev: '"1"' });

    let putCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putCalls += 1;
        if (putCalls === 1) {
          // First PUT uses the stale If-Match and is rejected.
          expect((init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
          return Promise.resolve(errorResponse(409, "This trip was changed on another device."));
        }
        // Second PUT (after merge) must carry both expenses.
        const body = JSON.parse(String(init.body)) as { expenses: Array<{ id: string }> };
        expect(body.expenses.map((e) => e.id).sort()).toEqual(["local-expense", "remote-expense"]);
        expect((init.headers as Record<string, string>)["If-Match"]).toBe('"2"');
        return Promise.resolve(jsonResponse(remote, 3));
      }
      // GET to fetch the latest remote state during conflict resolution.
      return Promise.resolve(jsonResponse(remote, 2));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();

    expect(await loadQueue()).toHaveLength(0);
    expect(putCalls).toBe(2);
  });

  it("flags a true conflict instead of silently overwriting either side", async () => {
    const base = addExpense(
      addPerson(addPerson(createTrip("Ski trip"), "Alice"), "Bob"),
      { description: "Lift tickets", payer: "Alice", amount_cents: 5000, participants: ["Alice", "Bob"] },
      "shared-expense",
    );
    // Local edits the amount one way...
    const local = {
      ...base,
      expenses: base.expenses.map((e) => (e.id === "shared-expense" ? { ...e, amount_cents: 6000 } : e)),
    };
    // ...remote edits the same expense a different way.
    const remote = {
      ...base,
      expenses: base.expenses.map((e) => (e.id === "shared-expense" ? { ...e, amount_cents: 7000 } : e)),
    };

    await enqueue(tripId, local, { trip: base, rev: '"1"' });

    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(errorResponse(409, "This trip was changed on another device."));
      }
      return Promise.resolve(jsonResponse(remote, 2));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();
    let queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.conflict).toBe(true);

    // Flushing again must not drop the conflicted item, even repeatedly.
    for (let i = 0; i < 5; i++) {
      await flushQueue();
    }
    queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.conflict).toBe(true);
  });

  it("still flushes old queue items with no base rev using the pre-ETag fallback", async () => {
    const trip = createTrip("Legacy");
    await enqueue(tripId, trip);

    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string> | undefined)?.["If-Match"]).toBeUndefined();
      return Promise.resolve(jsonResponse(trip, 1));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();
    expect(await loadQueue()).toHaveLength(0);
  });
});
