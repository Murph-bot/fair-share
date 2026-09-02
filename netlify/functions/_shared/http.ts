import type { Trip } from "../../../web/src/domain/trip";
import { FairShareError, RateLimitError, ValidationError } from "../../../web/src/domain/errors";
import { pinAttemptsStore } from "./stores";

export const MAX_JSON_BYTES = 200_000;
const PIN_ATTEMPT_LIMIT = 8;
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(err: unknown): Response {
  if (err && typeof err === "object" && "statusCode" in err) {
    const status = (err as { statusCode: unknown }).statusCode;
    if (typeof status === "number") {
      const message = err instanceof Error ? err.message : "Request failed";
      return json(status, { error: message });
    }
  }
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "Something went wrong";
  if (
    err instanceof FairShareError ||
    name === "ValidationError" ||
    name === "UnknownPersonError" ||
    name === "ExpenseNotFoundError"
  ) {
    return json(400, { error: message });
  }
  return json(500, { error: "Something went wrong" });
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (raw.length > MAX_JSON_BYTES) {
    throw new ValidationError("Payload is too large");
  }
  if (!raw.trim()) {
    throw new ValidationError("Request body is required");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError("Invalid JSON");
  }
}

export function pinPepper(): string {
  const value = Netlify.env.get("PHOTO_PIN_PEPPER") ?? process.env.PHOTO_PIN_PEPPER;
  if (!value) {
    throw new Error("Photo PIN is not configured");
  }
  return value;
}

export function pinHashFromRecord(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const hash = (raw as { pin_hash?: unknown }).pin_hash;
  if (typeof hash !== "string" || hash.length === 0) {
    return undefined;
  }
  return hash;
}

export function publicTrip(trip: Trip, photosLocked: boolean): Trip & { photos_locked: boolean } {
  return { ...trip, photos_locked: photosLocked };
}

export function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = header.slice(7).trim();
  return token || undefined;
}

function attemptKey(tripId: string, ip: string): string {
  return `${tripId}:${ip.replaceAll(":", "_").slice(0, 80)}`;
}

export async function assertPinAllowed(tripId: string, ip: string): Promise<void> {
  const store = pinAttemptsStore();
  const key = attemptKey(tripId, ip);
  const raw = (await store.get(key, { type: "json" })) as { count?: number; resetAt?: number } | null;
  const now = Date.now();
  if (raw && typeof raw.resetAt === "number" && raw.resetAt > now && (raw.count ?? 0) >= PIN_ATTEMPT_LIMIT) {
    throw new RateLimitError("Too many PIN attempts. Try again later.");
  }
}

export async function recordPinFailure(tripId: string, ip: string): Promise<void> {
  const store = pinAttemptsStore();
  const key = attemptKey(tripId, ip);
  const raw = (await store.get(key, { type: "json" })) as { count?: number; resetAt?: number } | null;
  const now = Date.now();
  const resetAt =
    raw && typeof raw.resetAt === "number" && raw.resetAt > now ? raw.resetAt : now + PIN_ATTEMPT_WINDOW_MS;
  const count = raw && typeof raw.resetAt === "number" && raw.resetAt > now ? (raw.count ?? 0) + 1 : 1;
  await store.setJSON(key, { count, resetAt });
}

export async function clearPinFailures(tripId: string, ip: string): Promise<void> {
  const store = pinAttemptsStore();
  await store.delete(attemptKey(tripId, ip));
}
