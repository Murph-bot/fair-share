import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrip } from "@fairshare/domain/trip";
import { hashPin, verifySessionToken } from "@fairshare/domain/pin";
import { lockTripPhotos } from "../src/api";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv, TEST_PEPPER } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const validTripId = "11111111111111111111111111111111";

describe("POST /api/trips/:id/pin", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let pinAttempts: Map<string, unknown>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    pinAttempts = fake.pinAttempts;
  });

  it("returns 404 if trip does not exist", async () => {
    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 if tripId is invalid format", async () => {
    const req = new Request("https://example.com/api/trips/short-id/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("sets generated 6-digit PIN on a grandfathered trip when body is empty", async () => {
    const trip = createTrip("Grandfathered Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { pin: string; photos_token: string };
    expect(body.pin).toMatch(/^\d{6}$/);
    expect(typeof body.photos_token).toBe("string");
    expect(await verifySessionToken(body.photos_token, validTripId, TEST_PEPPER)).toBe(true);

    const stored = trips.get(validTripId) as { pin_hash: string; name: string };
    expect(typeof stored.pin_hash).toBe("string");
    expect(stored.name).toBe("Grandfathered Trip");
  });

  it("sets custom 6-digit PIN on a grandfathered trip when provided", async () => {
    const trip = createTrip("Old Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "654321" }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { pin: string; photos_token: string };
    expect(body.pin).toBe("654321");
    expect(await verifySessionToken(body.photos_token, validTripId, TEST_PEPPER)).toBe(true);

    // Verify session unlock with the custom PIN
    const sessionReq = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "654321" }),
    });
    const sessionRes = await handleApiRequest(sessionReq, env);
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { token: string };
    expect(typeof sessionBody.token).toBe("string");

    // Verify session unlock with wrong PIN fails
    const wrongSessionReq = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    const wrongSessionRes = await handleApiRequest(wrongSessionReq, env);
    expect(wrongSessionRes.status).toBe(401);
  });

  it("rejects invalid PIN formats with 400", async () => {
    const trip = createTrip("Old Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123" }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PIN must be 6 digits/i);
  });

  it("returns 400 if trip already has a pin_hash (no rotate)", async () => {
    const pinHash = await hashPin("112233", validTripId, TEST_PEPPER);
    const trip = { ...createTrip("Locked Trip"), pin_hash: pinHash };
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "999999" }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already has a PIN/i);
  });

  it("returns 405 for non-POST methods on /pin", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "GET",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(405);
  });

  it("handleSession returns 400 when trip has no PIN set", async () => {
    const trip = createTrip("Open Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/does not lock photos/i);
  });

  it("PUT preserves pin_hash after it has been set", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    // Set PIN
    const pinReq = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "112233" }),
    });
    const pinRes = await handleApiRequest(pinReq, env);
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
    const putRes = await handleApiRequest(putReq, env);
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { photos_locked: boolean };
    expect(putBody.photos_locked).toBe(true);

    const stored = trips.get(validTripId) as { pin_hash: string; name: string };
    expect(typeof stored.pin_hash).toBe("string");
    expect(stored.name).toBe("Renamed Trip");
  });

  it("rejects payload exceeding MAX_JSON_BYTES with 400", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    const oversized = JSON.stringify({ pin: "123456", extra: "x".repeat(200_001) });
    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/payload is too large/i);
  });

  it("rejects malformed JSON with 400", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid JSON/i);
  });

  it("rejects non-object body with 400", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["123456"]),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/body must be an object/i);
  });

  it("accepts numeric pin in body and converts to 6 digits", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: 123456 }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pin: string };
    expect(body.pin).toBe("123456");
  });

  it("returns 429 when rate limit of PIN attempts is exceeded", async () => {
    const trip = createTrip("Trip");
    trips.set(validTripId, trip);

    // Pre-populate 8 failed attempts with future resetAt
    pinAttempts.set(`pin:attempts:${validTripId}:127.0.0.1`, {
      count: 8,
      resetAt: Date.now() + 60_000,
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
      body: JSON.stringify({ pin: "123456" }),
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
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
