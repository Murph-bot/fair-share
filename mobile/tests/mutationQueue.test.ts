import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDataStorage, configureStorage, memoryTokenStore } from "../src/api/storage";
import { createTrip } from "../src/domain";
import { enqueue, flushQueue, hasQueued, loadQueue } from "../src/api/mutationQueue";

const tripId = "ff4765be974564a2503e8f94f67538dd";

function okResponse() {
  const trip = createTrip("Trip");
  return new Response(JSON.stringify({ ...trip, photos_locked: false }), { status: 200 });
}

beforeEach(() => {
  configureStorage(memoryTokenStore());
  configureDataStorage(memoryTokenStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mutationQueue", () => {
  it("enqueues and reports pending mutations per trip", async () => {
    await enqueue(tripId, createTrip("A"));
    await enqueue("aa".repeat(16), createTrip("B"));
    expect(await hasQueued(tripId)).toBe(true);
    expect(await hasQueued("bb".repeat(16))).toBe(false);
    expect(await loadQueue()).toHaveLength(2);
  });

  it("flushes queued mutations and clears them on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    await enqueue(tripId, createTrip("A"));
    await flushQueue();
    expect(await loadQueue()).toHaveLength(0);
  });

  it("stops at the first failure on network error without burning attempts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network request failed")));
    await enqueue(tripId, createTrip("A"));
    await enqueue(tripId, createTrip("A2"));
    await flushQueue();
    const queue = await loadQueue();
    expect(queue).toHaveLength(2);
    expect(queue.every((item) => (item.attempts ?? 0) === 0)).toBe(true);
  });

  it("drops a permanently failing mutation after max attempts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "gone" }), { status: 404 })),
    );
    await enqueue(tripId, createTrip("A"));
    for (let i = 0; i < 5; i++) {
      await flushQueue();
    }
    expect(await loadQueue()).toHaveLength(0);
  });

  it("continues past a permanently failing item to flush later ones", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: "gone" }), { status: 404 }));
        }
        return Promise.resolve(okResponse());
      }),
    );
    await enqueue(tripId, createTrip("A"));
    await enqueue("aa".repeat(16), createTrip("B"));
    await flushQueue();
    const queue = await loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.tripId).toBe(tripId);
    expect(queue[0]?.attempts).toBe(1);
  });
});
