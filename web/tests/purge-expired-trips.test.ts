import { beforeEach, describe, expect, it } from "vitest";
import { TRIP_RETENTION_MS } from "@fairshare/domain/photos";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { PURGE_BATCH_SIZE, purgeExpiredTrips } from "../../pages/functions/_shared/expiry";
import { makeFakeEnv, type FakePhoto } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const SECRET = "cron-secret-for-testing-only";
const PURGE_URL = "https://example.com/api/admin/purge-expired-trips";
const NOW = Date.parse("2027-01-01T00:00:00Z");

const oldTrip = "11111111111111111111111111111111";
const recentTrip = "22222222222222222222222222222222";
const photoA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const photoB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
const photo = (): FakePhoto => ({ data: new Uint8Array([1]), metadata: {}, uploaded: new Date(NOW) });

describe("purgeExpiredTrips", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let updatedAt: Map<string, string>;
  let photos: Map<string, FakePhoto>;
  let counters: Map<string, { count: number; expiresAt: number }>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    updatedAt = fake.updatedAt;
    photos = fake.photos;
    counters = fake.counters;
  });

  function addTrip(id: string, changedMsAgo: number): void {
    trips.set(id, { name: id });
    updatedAt.set(id, iso(changedMsAgo));
  }

  it("deletes trips idle for a year, with every photo and original", async () => {
    addTrip(oldTrip, TRIP_RETENTION_MS + 1000);
    photos.set(`${oldTrip}/${photoA}`, photo());
    photos.set(`${oldTrip}/${photoA}/original`, photo());
    photos.set(`${oldTrip}/${photoB}`, photo());

    const result = await purgeExpiredTrips(env, NOW);

    expect(result).toEqual({ deleted: 1, more: false });
    expect(trips.has(oldTrip)).toBe(false);
    expect(photos.size).toBe(0);
  });

  it("keeps trips changed within the year and leaves their photos alone", async () => {
    addTrip(oldTrip, TRIP_RETENTION_MS + 1000);
    addTrip(recentTrip, TRIP_RETENTION_MS - 24 * 60 * 60 * 1000);
    photos.set(`${oldTrip}/${photoA}`, photo());
    photos.set(`${recentTrip}/${photoA}`, photo());
    photos.set(`${recentTrip}/${photoA}/original`, photo());

    await purgeExpiredTrips(env, NOW);

    expect(trips.has(recentTrip)).toBe(true);
    expect([...photos.keys()].sort()).toEqual([`${recentTrip}/${photoA}`, `${recentTrip}/${photoA}/original`]);
  });

  it("works in batches and says when more remain", async () => {
    for (let i = 0; i < PURGE_BATCH_SIZE + 3; i++) {
      addTrip(String(i).padStart(32, "0"), TRIP_RETENTION_MS + 1000 + i);
    }

    expect(await purgeExpiredTrips(env, NOW)).toEqual({ deleted: PURGE_BATCH_SIZE, more: true });
    expect(await purgeExpiredTrips(env, NOW)).toEqual({ deleted: 3, more: false });
    expect(trips.size).toBe(0);
  });

  it("drops rate-limit counters whose window has passed", async () => {
    counters.set("pin-client:x:1", { count: 3, expiresAt: Math.floor(Date.now() / 1000) - 10 });
    counters.set("pin-client:x:2", { count: 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 });

    await purgeExpiredTrips(env, Date.now());

    expect([...counters.keys()]).toEqual(["pin-client:x:2"]);
  });
});

describe("POST /api/admin/purge-expired-trips", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let updatedAt: Map<string, string>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = { ...fake.env, CRON_SECRET: SECRET };
    trips = fake.trips;
    updatedAt = fake.updatedAt;
    trips.set(oldTrip, { name: "old" });
    updatedAt.set(oldTrip, new Date(Date.now() - TRIP_RETENTION_MS - 1000).toISOString());
  });

  const call = (method: string, token?: string, e: Env = env): Promise<Response> =>
    handleApiRequest(
      new Request(PURGE_URL, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} }),
      e,
    );

  it("purges with the right secret", async () => {
    const res = await call("POST", SECRET);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1, more: false });
    expect(trips.has(oldTrip)).toBe(false);
  });

  it("rejects a wrong or missing secret and deletes nothing", async () => {
    expect((await call("POST", "wrong-secret-of-same-len-xx")).status).toBe(403);
    expect((await call("POST")).status).toBe(403);
    expect(trips.has(oldTrip)).toBe(true);
  });

  it("rejects everything when no secret is configured", async () => {
    const res = await call("POST", "undefined", { ...env, CRON_SECRET: undefined });

    expect(res.status).toBe(403);
    expect(trips.has(oldTrip)).toBe(true);
  });

  it("accepts POST only", async () => {
    expect((await call("GET", SECRET)).status).toBe(405);
    expect(trips.has(oldTrip)).toBe(true);
  });
});

describe("photo changes count as trip changes", () => {
  it("deleting a photo restarts the trip's retention clock", async () => {
    const { env, trips, updatedAt, photos } = makeFakeEnv();
    trips.set(recentTrip, { name: "t" });
    updatedAt.set(recentTrip, iso(TRIP_RETENTION_MS * 2));
    photos.set(`${recentTrip}/${photoA}`, photo());

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${recentTrip}/photos/${photoA}`, { method: "DELETE" }),
      env,
    );

    expect(res.status).toBe(200);
    expect(Date.parse(updatedAt.get(recentTrip) ?? "")).toBeGreaterThan(Date.now() - 60_000);
  });
});
