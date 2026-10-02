import { beforeEach, describe, expect, it } from "vitest";
import { hashPin } from "@fairshare/domain/pin";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv, TEST_PEPPER } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "55555555555555555555555555555555";

function attempt(env: Env, ip: string, pin = "000000"): Promise<Response> {
  return handleApiRequest(
    new Request(`https://example.com/api/trips/${tripId}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ pin }),
    }),
    env,
  );
}

describe("PIN attempt limiting", () => {
  let env: Env;

  beforeEach(async () => {
    const fake = makeFakeEnv();
    env = fake.env;
    fake.trips.set(tripId, {
      name: "Locked",
      people: ["A"],
      expenses: [],
      pin_hash: await hashPin("123456", tripId, TEST_PEPPER),
    });
  });

  it("50 parallel wrong PINs from one IP: at most 8 are evaluated", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => attempt(env, "203.0.113.7")));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(8);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(42);
  });

  it("rotating addresses inside one IPv6 /64 shares a single bucket", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await attempt(env, `2001:db8:1:2::${(i + 1).toString(16)}`)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(4);
  });

  it("a per-trip cap stops guessing from many different IPs", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) {
      statuses.push((await attempt(env, `198.51.100.${i}`)).status);
    }
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(50);
    expect(statuses.at(-1)).toBe(429);
  });

  it("the right PIN still works after a few wrong ones", async () => {
    await attempt(env, "203.0.113.9");
    await attempt(env, "203.0.113.9");
    const ok = await attempt(env, "203.0.113.9", "123456");
    expect(ok.status).toBe(200);
  });
});
