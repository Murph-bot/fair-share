import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteTrip } from "../src/api";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { clientKey } from "../../pages/functions/_shared/http";
import {
  PHOTO_UPLOADS_PER_WINDOW,
  TRIP_CREATES_PER_DAY,
  TRIP_CREATES_PER_HOUR,
} from "../../pages/functions/_shared/rateLimit";
import { makeFakeEnv } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const HOUR_MS = 60 * 60 * 1000;

function createTripRequest(ip: string): Request {
  return new Request("https://example.com/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ name: "Trip" }),
  });
}

function uploadRequest(tripId: string, ip: string, token: string): Request {
  const form = new FormData();
  form.append(
    "photo",
    new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "p.jpg", { type: "image/jpeg" }),
  );
  return new Request(`https://example.com/api/trips/${tripId}/photos`, {
    method: "POST",
    headers: { "CF-Connecting-IP": ip, Authorization: `Bearer ${token}` },
    body: form,
  });
}

describe("rate limits", () => {
  let env: Env;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    env = makeFakeEnv().env;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 429 with a message once a client creates too many trips in an hour", async () => {
    for (let i = 0; i < TRIP_CREATES_PER_HOUR; i++) {
      expect((await handleApiRequest(createTripRequest("203.0.113.5"), env)).status).toBe(201);
    }
    const res = await handleApiRequest(createTripRequest("203.0.113.5"), env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/too many trips/i);
    expect((await handleApiRequest(createTripRequest("203.0.113.6"), env)).status).toBe(201);
  });

  it("treats addresses in one IPv6 /64 as one client", async () => {
    for (let i = 0; i < TRIP_CREATES_PER_HOUR; i++) {
      await handleApiRequest(createTripRequest(`2001:db8:1:2:${i + 1}::1`), env);
    }
    expect((await handleApiRequest(createTripRequest("2001:db8:1:2:ffff::9"), env)).status).toBe(429);
    expect((await handleApiRequest(createTripRequest("2001:db8:1:3::1"), env)).status).toBe(201);
  });

  it("caps trip creation per day even when each hour is within its limit", async () => {
    const hoursNeeded = TRIP_CREATES_PER_DAY / TRIP_CREATES_PER_HOUR;
    for (let hour = 0; hour < hoursNeeded; hour++) {
      for (let i = 0; i < TRIP_CREATES_PER_HOUR; i++) {
        expect((await handleApiRequest(createTripRequest("203.0.113.7"), env)).status).toBe(201);
      }
      vi.setSystemTime(Date.now() + HOUR_MS);
    }
    const res = await handleApiRequest(createTripRequest("203.0.113.7"), env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/today/i);
  });

  it("allows trip creation again after the hour window passes", async () => {
    for (let i = 0; i <= TRIP_CREATES_PER_HOUR; i++) {
      await handleApiRequest(createTripRequest("203.0.113.8"), env);
    }
    vi.setSystemTime(Date.now() + HOUR_MS);
    expect((await handleApiRequest(createTripRequest("203.0.113.8"), env)).status).toBe(201);
  });

  it("returns 429 once a client uploads too many photos in the window", async () => {
    const created = await handleApiRequest(createTripRequest("198.51.100.1"), env);
    const { id, photos_token } = (await created.json()) as { id: string; photos_token: string };
    const upload = (ip: string) => uploadRequest(id, ip, photos_token);
    for (let i = 0; i < PHOTO_UPLOADS_PER_WINDOW; i++) {
      expect((await handleApiRequest(upload("203.0.113.9"), env)).status).toBe(201);
    }
    const res = await handleApiRequest(upload("203.0.113.9"), env);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/too many photos/i);
    expect((await handleApiRequest(upload("203.0.113.10"), env)).status).toBe(201);
  });
});

describe("clientKey", () => {
  const key = (ip?: string, env: { FAIRSHARE_PROXY_SECRET?: string } = {}) =>
    clientKey(new Request("https://example.com/", ip ? { headers: { "CF-Connecting-IP": ip } } : {}), env);

  it("keeps IPv4 as is", () => {
    expect(key("203.0.113.5")).toBe("203.0.113.5");
  });

  it("reduces IPv6 to its /64, expanding ::", () => {
    expect(key("2001:DB8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(key("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(key("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("maps IPv4-mapped IPv6 back to IPv4", () => {
    expect(key("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("falls back to unknown without the header", () => {
    expect(key()).toBe("unknown");
  });
});

describe("clientKey behind the pithelo proxy", () => {
  const SECRET = "test-proxy-secret";
  const EGRESS = "2a06:98c0:3600::103";
  const via = (headers: Record<string, string>, env: { FAIRSHARE_PROXY_SECRET?: string }) =>
    clientKey(
      new Request("https://example.com/", { headers: { "CF-Connecting-IP": EGRESS, ...headers } }),
      env,
    );
  const egressKey = "2a06:98c0:3600:0000::/64";

  it("uses the forwarded IP when the secret matches", () => {
    const headers = { "X-FairShare-Client-IP": "198.51.100.7", "X-FairShare-Proxy-Secret": SECRET };
    expect(via(headers, { FAIRSHARE_PROXY_SECRET: SECRET })).toBe("198.51.100.7");
  });

  it("reduces a forwarded IPv6 address to its /64", () => {
    const headers = { "X-FairShare-Client-IP": "2001:db8:1:2::9", "X-FairShare-Proxy-Secret": SECRET };
    expect(via(headers, { FAIRSHARE_PROXY_SECRET: SECRET })).toBe("2001:0db8:0001:0002::/64");
  });

  it("ignores the forwarded IP when the secret is wrong", () => {
    const headers = { "X-FairShare-Client-IP": "198.51.100.7", "X-FairShare-Proxy-Secret": "nope" };
    expect(via(headers, { FAIRSHARE_PROXY_SECRET: SECRET })).toBe(egressKey);
  });

  it("ignores the forwarded IP when the secret header is missing", () => {
    expect(via({ "X-FairShare-Client-IP": "198.51.100.7" }, { FAIRSHARE_PROXY_SECRET: SECRET })).toBe(
      egressKey,
    );
  });

  it("ignores the forwarded IP when no secret is configured", () => {
    const headers = { "X-FairShare-Client-IP": "198.51.100.7", "X-FairShare-Proxy-Secret": SECRET };
    expect(via(headers, {})).toBe(egressKey);
    expect(via({ ...headers, "X-FairShare-Proxy-Secret": "" }, { FAIRSHARE_PROXY_SECRET: "" })).toBe(
      egressKey,
    );
  });

  it("falls back when the forwarded value is not an IP literal or is too long", () => {
    const base = { "X-FairShare-Proxy-Secret": SECRET };
    const env = { FAIRSHARE_PROXY_SECRET: SECRET };
    for (const bad of ["not-an-ip", "198.51.100.7, 10.0.0.1", "999.1.1.1", "a".repeat(200), "::g", ""]) {
      expect(via({ ...base, "X-FairShare-Client-IP": bad }, env)).toBe(egressKey);
    }
  });

  it("never echoes the proxy headers in a response", async () => {
    const { env } = makeFakeEnv();
    const res = await handleApiRequest(
      new Request("https://example.com/api/trips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": EGRESS,
          "X-FairShare-Client-IP": "198.51.100.7",
          "X-FairShare-Proxy-Secret": SECRET,
        },
        body: JSON.stringify({ name: "Trip" }),
      }),
      { ...env, FAIRSHARE_PROXY_SECRET: SECRET },
    );
    expect(res.status).toBe(201);
    expect([...res.headers.keys()].some((k) => k.startsWith("x-fairshare"))).toBe(false);
    expect(await res.text()).not.toContain(SECRET);
  });
});

describe("createRemoteTrip", () => {
  it("shows the server's rate limit message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Too many trips created. Try again in an hour." }), {
          status: 429,
        }),
      ),
    );
    await expect(createRemoteTrip("Trip")).rejects.toThrow("Too many trips created. Try again in an hour.");
    vi.unstubAllGlobals();
  });
});
