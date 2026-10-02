import { beforeEach, describe, expect, it } from "vitest";
import { createTrip } from "@fairshare/domain/trip";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "44444444444444444444444444444444";
const url = `https://example.com/api/trips/${tripId}`;

function put(env: Env, body: unknown, ifMatch?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ifMatch !== undefined) headers["If-Match"] = ifMatch;
  return handleApiRequest(new Request(url, { method: "PUT", headers, body: JSON.stringify(body) }), env);
}

describe("trip revisions (optimistic concurrency)", () => {
  let env: Env;
  let trips: Map<string, unknown>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    trips.set(tripId, createTrip("Shared"));
  });

  it("GET returns an ETag", async () => {
    const res = await handleApiRequest(new Request(url), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toMatch(/^"\d+"$/);
  });

  it("a stale If-Match gets 409 and does not overwrite the newer edit", async () => {
    const get = await handleApiRequest(new Request(url), env);
    const etag = get.headers.get("ETag") ?? "";
    const base = (await get.json()) as Record<string, unknown>;

    const first = await put(env, { ...base, name: "Phone A" }, etag);
    expect(first.status).toBe(200);
    expect(first.headers.get("ETag")).not.toBe(etag);

    const second = await put(env, { ...base, name: "Phone B (stale)" }, etag);
    expect(second.status).toBe(409);
    expect((trips.get(tripId) as { name: string }).name).toBe("Phone A");
  });

  it("PUT without If-Match still works (old clients) and bumps the revision", async () => {
    const get = await handleApiRequest(new Request(url), env);
    const etag = get.headers.get("ETag");
    const base = (await get.json()) as Record<string, unknown>;
    const res = await put(env, { ...base, name: "Legacy" });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).not.toBe(etag);
  });

  it("keeps pin_hash across revisions", async () => {
    trips.set(tripId, { ...createTrip("Locked"), pin_hash: "h" });
    const get = await handleApiRequest(new Request(url), env);
    const base = (await get.json()) as Record<string, unknown>;
    await put(env, { ...base, name: "Locked 2" }, get.headers.get("ETag") ?? undefined);
    expect((trips.get(tripId) as { pin_hash: string }).pin_hash).toBe("h");
  });
});

describe("web client sends If-Match from the last known revision", () => {
  it("fetchTrip remembers the ETag and saveTrip sends it, then the new one", async () => {
    const { vi } = await import("vitest");
    const { fetchTrip, saveTrip } = await import("../src/api");
    const fake = makeFakeEnv();
    fake.trips.set(tripId, createTrip("Shared"));
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) =>
      handleApiRequest(new Request(`https://example.com${input}`, init), fake.env),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const trip = await fetchTrip(tripId);
      await saveTrip(tripId, { ...trip, name: "One" });
      await saveTrip(tripId, { ...trip, name: "Two" });
      const sent = fetchMock.mock.calls
        .filter(([, init]) => init?.method === "PUT")
        .map(([, init]) => new Headers(init?.headers).get("If-Match"));
      expect(sent).toEqual(['"0"', '"1"']);
      expect((fake.trips.get(tripId) as { name: string }).name).toBe("Two");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
