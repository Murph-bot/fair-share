import { afterEach, describe, expect, it, vi } from "vitest";

import { addExpense, addPerson, createTrip, type Trip } from "../src/domain";
import { createRemoteTrip, fetchTrip, saveTrip } from "../src/api/tripApi";

const tripId = "ff4765be974564a2503e8f94f67538dd";

function mockJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tripApi", () => {
  it("creates a remote trip", async () => {
    const trip = createTrip("Audit Test");
    const fetchSpy = vi.fn().mockResolvedValue(
      mockJsonResponse({
        id: tripId,
        trip,
        pin: "123456",
        photos_token: "token-123",
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createRemoteTrip("Audit Test")).resolves.toEqual({
      id: tripId,
      trip: { ...trip, photos_locked: false },
      pin: "123456",
      photos_token: "token-123",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://fair-share-trips.netlify.app/api/trips",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fetches and parses a trip", async () => {
    const trip = addExpense(
      addPerson(addPerson(createTrip("CLI push check"), "Alice"), "Bob"),
      {
        description: "Dinner",
        payer: "Alice",
        amount_cents: 4000,
        participants: ["Alice", "Bob"],
      },
      "expense-1",
    );

    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(trip));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchTrip(tripId)).resolves.toEqual({ ...trip, photos_locked: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://fair-share-trips.netlify.app/api/trips/${tripId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws the server error on fetch failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse({ error: "Trip not found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchTrip(tripId)).rejects.toThrow("Trip not found");
  });

  it("sends only money fields on save", async () => {
    const expectedTrip = addExpense(
      addPerson(addPerson(createTrip("CLI push check"), "Alice"), "Bob"),
      {
        description: "Dinner",
        payer: "Alice",
        amount_cents: 4000,
        participants: ["Alice", "Bob"],
      },
      "expense-1",
    );
    const trip = {
      ...expectedTrip,
      pin_hash: "secret",
      photos_locked: true,
    } as Trip & { pin_hash?: string; photos_locked?: boolean };

    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(trip));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(saveTrip(tripId, trip)).resolves.toEqual({
      ...expectedTrip,
      photos_locked: true,
    });
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    expect(options?.method).toBe("PUT");
    expect(JSON.parse(String(options?.body))).toEqual({
      schema_version: 1,
      name: "CLI push check",
      people: ["Alice", "Bob"],
      expenses: [
        {
          id: "expense-1",
          description: "Dinner",
          payer: "Alice",
          amount_cents: 4000,
          participants: ["Alice", "Bob"],
        },
      ],
    });
  });

  it("preserves photos_locked on fetch", async () => {
    const trip = createTrip("Locked trip");
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse({ ...trip, photos_locked: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchTrip(tripId)).resolves.toEqual({ ...trip, photos_locked: true });
  });

  it("treats missing photos_locked as unlocked", async () => {
    const trip = createTrip("Open trip");
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(trip));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchTrip(tripId)).resolves.toEqual({ ...trip, photos_locked: false });
  });
});
