import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDataStorage, configureStorage, memoryTokenStore } from "../src/api/storage";
import { addExpense, addPerson, createTrip, type Trip } from "../src/domain";
import { clearConflictNotice, enqueue, flushQueue, loadConflictNotice, loadQueue } from "../src/api/mutationQueue";

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
    // No field-level or item-level conflicts here, so nothing to notify about.
    expect(await loadConflictNotice(tripId)).toBeNull();
  });

  it("resolves a true conflict by saving the merge, dequeuing the item, and recording a dismissable notice", async () => {
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

    let putCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putCalls += 1;
        if (putCalls === 1) {
          return Promise.resolve(errorResponse(409, "This trip was changed on another device."));
        }
        // The merged save must keep the remote's amount for the conflicting
        // expense rather than silently taking either side's local edit.
        const body = JSON.parse(String(init.body)) as { expenses: Array<{ id: string; amount_cents: number }> };
        const expense = body.expenses.find((e) => e.id === "shared-expense");
        expect(expense?.amount_cents).toBe(7000);
        return Promise.resolve(jsonResponse(remote, 3));
      }
      return Promise.resolve(jsonResponse(remote, 2));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();

    // The item is not stuck forever: it's saved and removed from the queue.
    expect(await loadQueue()).toHaveLength(0);
    expect(putCalls).toBe(2);

    // What was discarded is recorded so the UI can tell the user and let them dismiss it.
    const notice = await loadConflictNotice(tripId);
    expect(notice?.discarded).toHaveLength(1);
    expect(notice?.discarded[0]).toMatchObject({ type: "expense", id: "shared-expense" });

    await clearConflictNotice(tripId);
    expect(await loadConflictNotice(tripId)).toBeNull();
  });

  it("gives up after a bounded number of conflict retries without dropping the item", async () => {
    const base = createTrip("Racey");
    const local = addPerson(base, "Alice");
    await enqueue(tripId, local, { trip: base, rev: '"1"' });

    let putCalls = 0;
    let getCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putCalls += 1;
        return Promise.resolve(errorResponse(409, "This trip was changed on another device."));
      }
      getCalls += 1;
      return Promise.resolve(jsonResponse(base, 2));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();

    const queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.attempts ?? 0).toBe(0);
    // 1 initial attempt (stale If-Match) + 3 bounded merge-and-retry attempts.
    expect(putCalls).toBe(4);
    expect(getCalls).toBe(3);
  });

  it("merges against the latest remote before saving when a base snapshot exists but no rev was recorded", async () => {
    // e.g. the app restarted offline before this edit's rev made it to storage.
    const base = addPerson(addPerson(createTrip("Trip"), "Alice"), "Bob");
    const local = addExpense(
      base,
      { description: "Taxi", payer: "Alice", amount_cents: 1000, participants: ["Alice", "Bob"] },
      "local-expense",
    );
    const remote = addExpense(
      base,
      { description: "Snacks", payer: "Bob", amount_cents: 500, participants: ["Alice", "Bob"] },
      "remote-expense",
    );

    await enqueue(tripId, local, { trip: base, rev: undefined });
    const queuedBefore = await loadQueue();
    expect(queuedBefore[0]?.baseTrip).toBeDefined();
    expect(queuedBefore[0]?.baseRev).toBeUndefined();

    let getCalls = 0;
    let putCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        putCalls += 1;
        const body = JSON.parse(String(init.body)) as { expenses: Array<{ id: string }> };
        expect(body.expenses.map((e) => e.id).sort()).toEqual(["local-expense", "remote-expense"]);
        return Promise.resolve(jsonResponse(remote, 2));
      }
      getCalls += 1;
      return Promise.resolve(jsonResponse(remote, 1));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();

    // It fetched and merged before saving instead of blindly overwriting remote.
    expect(getCalls).toBe(1);
    expect(putCalls).toBe(1);
    expect(await loadQueue()).toHaveLength(0);
  });

  it("still flushes legacy queue items with neither a base snapshot nor a rev", async () => {
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

  it("disambiguates duplicate completed payments by occurrence instead of collapsing them", async () => {
    const payment = (paidCents: number) => ({ frm: "Alice", to: "Bob", amount_cents: 2000, paid_cents: paidCents });
    // Two identical (frm/to/amount) payments existed before the offline edit.
    const base: Trip = { ...createTrip("Split"), completedPayments: [payment(0), payment(0)] };
    // Locally, only the second one gets marked paid.
    const local: Trip = { ...base, completedPayments: [payment(0), payment(2000)] };
    // Remote is unchanged from base, but at a newer rev (e.g. an unrelated edit).
    const remote: Trip = { ...base };

    await enqueue(tripId, local, { trip: base, rev: '"1"' });

    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        if ((init.headers as Record<string, string>)["If-Match"] === '"1"') {
          return Promise.resolve(errorResponse(409, "This trip was changed on another device."));
        }
        const body = JSON.parse(String(init.body)) as { completedPayments: Array<{ paid_cents?: number }> };
        // Both duplicate payments must survive the merge, one still unpaid.
        expect(body.completedPayments).toHaveLength(2);
        expect(body.completedPayments.map((p) => p.paid_cents ?? 0).sort()).toEqual([0, 2000]);
        return Promise.resolve(jsonResponse(remote, 3));
      }
      return Promise.resolve(jsonResponse(remote, 2));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await flushQueue();
    expect(await loadQueue()).toHaveLength(0);
  });
});

describe("tripApi rev persistence", () => {
  it("survives a restart by reloading the rev from the data store instead of falling back to a blind overwrite", async () => {
    const restartTripId = "cc".repeat(16);
    const persisted = memoryTokenStore();
    configureDataStorage(persisted);

    const trip = createTrip("Persisted rev");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(trip, 5)));
    const firstRunApi = await import("../src/api/tripApi");
    await firstRunApi.fetchTrip(restartTripId);
    vi.unstubAllGlobals();

    // Simulate an app restart: a fresh module graph with an empty in-memory
    // cache, backed by the same persisted data store.
    vi.resetModules();
    const freshStorage = await import("../src/api/storage");
    freshStorage.configureDataStorage(persisted);
    const freshTripApi = await import("../src/api/tripApi");

    await expect(freshTripApi.getKnownRev(restartTripId)).resolves.toBe('"5"');
  });
});
