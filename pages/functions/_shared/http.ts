import type { Trip } from "../../../packages/domain/src/trip";
import { FairShareError, ValidationError } from "../../../packages/domain/src/errors";
import type { Env } from "./env";

export const MAX_JSON_BYTES = 200_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
} as const;

export function corsHeaders(): Record<string, string> {
  return CORS_HEADERS;
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
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

export function pinPepper(env: Env): string {
  if (!env.PHOTO_PIN_PEPPER) {
    throw new Error("Photo PIN is not configured");
  }
  return env.PHOTO_PIN_PEPPER;
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

export function publicTrip(
  trip: Trip,
  photosLocked: boolean,
  revision: number,
): Trip & { photos_locked: boolean; revision: number } {
  return { ...trip, photos_locked: photosLocked, revision };
}

export function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = header.slice(7).trim();
  return token || undefined;
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

// Rate limits key on the /64, since one household or host controls a whole /64.
export function clientKey(req: Request): string {
  const ip = clientIp(req).toLowerCase();
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped) {
    return mapped[1];
  }
  if (!ip.includes(":")) {
    return ip.slice(0, 80);
  }
  const [head, tail, extra] = ip.split("::");
  if (extra !== undefined) {
    return ip.slice(0, 80);
  }
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - front.length - back.length;
  const groups = [...front, ...Array<string>(Math.max(fill, 0)).fill("0"), ...back];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
    return ip.slice(0, 80);
  }
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}
