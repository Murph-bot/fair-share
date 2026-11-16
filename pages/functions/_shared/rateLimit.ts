import { RateLimitError } from "../../../packages/domain/src/errors";
import type { Env } from "./env";

export const TRIP_CREATES_PER_HOUR = 10;
export const TRIP_CREATES_PER_DAY = 30;
export const PHOTO_UPLOADS_PER_WINDOW = 60;
export const PIN_ATTEMPTS_PER_TRIP = 30;
export const PIN_ATTEMPTS_PER_CLIENT = 8;

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const PHOTO_UPLOAD_WINDOW_SECONDS = 10 * 60;
const PIN_CLIENT_WINDOW_SECONDS = 15 * 60;

// One statement, so concurrent requests each get a distinct count.
const HIT_SQL = `INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, 1, ?2)
  ON CONFLICT(key) DO UPDATE SET count = count + 1
  RETURNING count`;

const PRUNE_SQL = "DELETE FROM rate_limits WHERE expires_at < ?";

export async function pruneRateLimits(env: Env): Promise<void> {
  await env.FAIRSHARE_DB.prepare(PRUNE_SQL).bind(Math.floor(Date.now() / 1000)).run();
}

async function hit(env: Env, scope: string, subject: string, windowSeconds: number): Promise<number> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(nowSeconds / windowSeconds);
  const row = await env.FAIRSHARE_DB.prepare(HIT_SQL)
    .bind(`${scope}:${subject}:${windowIndex}`, (windowIndex + 1) * windowSeconds)
    .first<{ count: number }>();
  if (!row) {
    throw new Error("Rate limit counter returned no row");
  }
  if (row.count === 1) {
    await env.FAIRSHARE_DB.prepare(PRUNE_SQL).bind(nowSeconds).run();
  }
  return row.count;
}

async function enforce(
  env: Env,
  scope: string,
  subject: string,
  windowSeconds: number,
  max: number,
  message: string,
): Promise<void> {
  if ((await hit(env, scope, subject, windowSeconds)) > max) {
    throw new RateLimitError(message);
  }
}

export async function limitTripCreation(env: Env, client: string): Promise<void> {
  await enforce(
    env,
    "trip-create-hour",
    client,
    HOUR_SECONDS,
    TRIP_CREATES_PER_HOUR,
    "Too many trips created. Try again in an hour.",
  );
  await enforce(
    env,
    "trip-create-day",
    client,
    DAY_SECONDS,
    TRIP_CREATES_PER_DAY,
    "Too many trips created today. Try again tomorrow.",
  );
}

export async function limitPhotoUpload(env: Env, client: string): Promise<void> {
  await enforce(
    env,
    "photo-upload",
    client,
    PHOTO_UPLOAD_WINDOW_SECONDS,
    PHOTO_UPLOADS_PER_WINDOW,
    "Too many photos uploaded. Try again in a few minutes.",
  );
}

// Every guess is counted before the PIN is checked, right or wrong, and nothing
// refunds it: a correct PIN from one client must not reset what an attacker has spent.
// The client counter runs first so one noisy client does not use up the trip's attempts.
export async function limitPinAttempt(env: Env, tripId: string, client: string): Promise<void> {
  const message = "Too many PIN attempts. Try again later.";
  await enforce(env, "pin-client", `${tripId}:${client}`, PIN_CLIENT_WINDOW_SECONDS, PIN_ATTEMPTS_PER_CLIENT, message);
  await enforce(env, "pin-trip", tripId, HOUR_SECONDS, PIN_ATTEMPTS_PER_TRIP, message);
}
