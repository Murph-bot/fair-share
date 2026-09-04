import type { Context } from "@netlify/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrip } from "@fairshare/domain/trip";
import { hashPin, verifySessionToken } from "@fairshare/domain/pin";
import { lockTripPhotos } from "../src/api";

const mockTrips = new Map<string, any>();
const mockPinAttempts = new Map<string, any>();

vi.mock("../../netlify/functions/_shared/stores", () => ({
  tripsStore: () => ({
    get: async (key: string) => mockTrips.get(key) ?? null,
    set: async (key: string, value: any) => {
      mockTrips.set(key, value);
    },
    setJSON: async (key: string, value: any) => {
      mockTrips.set(key, value);
    },
  }),
  photosStore: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => ({ blobs: [] }),
    getMetadata: async () => null,
  }),
  pinAttemptsStore: () => ({
    get: async (key: string) => mockPinAttempts.get(key) ?? null,
    set: async (key: string, value: any) => {
      mockPinAttempts.set(key, value);
    },
    setJSON: async (key: string, value: any) => {
      mockPinAttempts.set(key, value);
    },
    delete: async (key: string) => {
      mockPinAttempts.delete(key);
    },
  }),
}));

import handler from "../../netlify/functions/trips";

const PEPPER = "test-pepper-trips-pin-123456789";
process.env.PHOTO_PIN_PEPPER = PEPPER;

const validTripId = "11111111111111111111111111111111";

function makeContext(params: Record<string, string>): Context {
  return {
    params,
    account: {} as any,
    geo: {} as any,
    ip: "127.0.0.1",
    site: {} as any,
    deploy: {} as any,
    server: {} as any,
    requestId: "req-1",
    cookies: {} as any,
    next: async () => new Response(),
  } as unknown as Context;
}

describe("POST /api/trips/:id/pin", () => {
  beforeEach(() => {
    mockTrips.clear();
    mockPinAttempts.clear();
  });

  it("returns 404 if trip does not exist", async () => {
    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(404);
  });

  it("returns 404 if tripId is invalid format", async () => {
    const req = new Request("https://example.com/api/trips/short-id/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handler(req, makeContext({ id: "short-id" }));
    expect(res.status).toBe(404);
  });

  it("sets generated 6-digit PIN on a grandfathered trip when body is empty", async () => {
    const trip = createTrip("Grandfathered Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pin).toMatch(/^\d{6}$/);
    expect(typeof body.photos_token).toBe("string");
    expect(await verifySessionToken(body.photos_token, validTripId, PEPPER)).toBe(true);

    const stored = mockTrips.get(validTripId);
    expect(typeof stored.pin_hash).toBe("string");
    expect(stored.name).toBe("Grandfathered Trip");
  });

  it("sets custom 6-digit PIN on a grandfathered trip when provided", async () => {
    const trip = createTrip("Old Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "654321" }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pin).toBe("654321");
    expect(await verifySessionToken(body.photos_token, validTripId, PEPPER)).toBe(true);

    // Verify session unlock with the custom PIN
    const sessionReq = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "654321" }),
    });
    const sessionRes = await handler(sessionReq, makeContext({ id: validTripId }));
    expect(sessionRes.status).toBe(200);
    const sessionBody = await sessionRes.json();
    expect(typeof sessionBody.token).toBe("string");

    // Verify session unlock with wrong PIN fails
    const wrongSessionReq = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    const wrongSessionRes = await handler(wrongSessionReq, makeContext({ id: validTripId }));
    expect(wrongSessionRes.status).toBe(401);
  });

  it("rejects invalid PIN formats with 400", async () => {
    const trip = createTrip("Old Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123" }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/PIN must be 6 digits/i);
  });

  it("returns 400 if trip already has a pin_hash (no rotate)", async () => {
    const pinHash = await hashPin("112233", validTripId, PEPPER);
    const trip = { ...createTrip("Locked Trip"), pin_hash: pinHash };
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "999999" }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already has a PIN/i);
  });

  it("returns 405 for non-POST methods on /pin", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "GET",
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(405);
  });

  it("handleSession returns 400 when trip has no PIN set", async () => {
    const trip = createTrip("Open Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not lock photos/i);
  });

  it("PUT preserves pin_hash after it has been set", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    // Set PIN
    const pinReq = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "112233" }),
    });
    const pinRes = await handler(pinReq, makeContext({ id: validTripId }));
    expect(pinRes.status).toBe(200);

    // Now PUT with updated name/people
    const putReq = new Request(`https://example.com/api/trips/${validTripId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema_version: 1,
        name: "Renamed Trip",
        people: ["Bob"],
        expenses: [],
      }),
    });
    const putRes = await handler(putReq, makeContext({ id: validTripId }));
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.photos_locked).toBe(true);

    const stored = mockTrips.get(validTripId);
    expect(typeof stored.pin_hash).toBe("string");
    expect(stored.name).toBe("Renamed Trip");
  });

  it("rejects payload exceeding MAX_JSON_BYTES with 400", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    const oversized = JSON.stringify({ pin: "123456", extra: "x".repeat(200_001) });
    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/payload is too large/i);
  });

  it("rejects malformed JSON with 400", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid JSON/i);
  });

  it("rejects non-object body with 400", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["123456"]),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/body must be an object/i);
  });

  it("accepts numeric pin in body and converts to 6 digits", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: 123456 }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pin).toBe("123456");
  });

  it("returns 429 when rate limit of PIN attempts is exceeded", async () => {
    const trip = createTrip("Trip");
    mockTrips.set(validTripId, trip);

    // Pre-populate 8 failed attempts in pinAttemptsStore with future resetAt
    mockPinAttempts.set(`${validTripId}:127.0.0.1`, {
      count: 8,
      resetAt: Date.now() + 60_000,
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/too many pin attempts/i);
  });
});

describe("lockTripPhotos client API", () => {
  it("calls POST /api/trips/:id/pin and returns pin and photos_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pin: "123456", photos_token: "tok-abc" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lockTripPhotos(validTripId, "123456");
    expect(result).toEqual({ pin: "123456", photos_token: "tok-abc" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    vi.unstubAllGlobals();
  });

  it("calls POST /api/trips/:id/pin with empty object if pin omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pin: "654321", photos_token: "tok-xyz" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lockTripPhotos(validTripId);
    expect(result).toEqual({ pin: "654321", photos_token: "tok-xyz" });
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    vi.unstubAllGlobals();
  });

  it("throws error if API call fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Trip already has a PIN" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lockTripPhotos(validTripId)).rejects.toThrow("Trip already has a PIN");
    vi.unstubAllGlobals();
  });
});
