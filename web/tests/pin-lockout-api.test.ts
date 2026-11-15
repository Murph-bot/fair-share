import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPin } from "@fairshare/domain/pin";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import {
  PIN_ATTEMPTS_PER_CLIENT,
  PIN_ATTEMPTS_PER_TRIP,
} from "../../pages/functions/_shared/rateLimit";
import { makeFakeEnv, TEST_PEPPER } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "11111111111111111111111111111111";
const REAL_PIN = "123456";

function sessionRequest(ip: string, pin: string): Request {
  return new Request(`https://example.com/api/trips/${tripId}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ pin }),
  });
}

const status = async (env: Env, ip: string, pin: string) =>
  (await handleApiRequest(sessionRequest(ip, pin), env)).status;

describe("POST /api/trips/:id/session lockout", () => {
  let env: Env;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    const fake = makeFakeEnv();
    env = fake.env;
    fake.trips.set(tripId, {
      name: "Locked",
      people: ["Alice"],
      expenses: [],
      pin_hash: await hashPin(REAL_PIN, tripId, TEST_PEPPER),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets only the per-trip limit of parallel guesses through, however many addresses they use", async () => {
    const guesses = Array.from({ length: 100 }, (_, i) =>
      status(env, `203.0.113.${i + 1}`, String(100000 + i)),
    );
    const results = await Promise.all(guesses);
    expect(results.filter((s) => s === 401)).toHaveLength(PIN_ATTEMPTS_PER_TRIP);
    expect(results.filter((s) => s === 429)).toHaveLength(100 - PIN_ATTEMPTS_PER_TRIP);
  });

  it("refuses even the right PIN once the trip is out of attempts", async () => {
    for (let i = 0; i < PIN_ATTEMPTS_PER_TRIP; i++) {
      await status(env, `203.0.113.${i + 1}`, "000000");
    }
    expect(await status(env, "198.51.100.9", REAL_PIN)).toBe(429);
  });

  it("does not give attempts back when someone enters the right PIN", async () => {
    for (let i = 0; i < PIN_ATTEMPTS_PER_TRIP - 1; i++) {
      await status(env, `203.0.113.${i + 1}`, "000000");
    }
    expect(await status(env, "198.51.100.9", REAL_PIN)).toBe(200);
    expect(await status(env, "198.51.100.10", "000000")).toBe(429);
  });

  it("limits a single client sooner than the trip", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => status(env, "203.0.113.1", String(100000 + i))),
    );
    expect(results.filter((s) => s === 401)).toHaveLength(PIN_ATTEMPTS_PER_CLIENT);
    expect(await status(env, "203.0.113.2", REAL_PIN)).toBe(200);
  });

  it("allows guesses again after the window passes", async () => {
    for (let i = 0; i < PIN_ATTEMPTS_PER_TRIP; i++) {
      await status(env, `203.0.113.${i + 1}`, "000000");
    }
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    expect(await status(env, "198.51.100.9", REAL_PIN)).toBe(200);
  });

  it("does not spend attempts on a malformed PIN", async () => {
    for (let i = 0; i < 20; i++) {
      expect(await status(env, "203.0.113.1", "12")).toBe(400);
    }
    expect(await status(env, "203.0.113.1", REAL_PIN)).toBe(200);
  });
});
