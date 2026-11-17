import type { Trip } from "../../../packages/domain/src/trip";
import { FairShareError, ValidationError } from "../../../packages/domain/src/errors";
import { timingSafeEqual } from "../../../packages/domain/src/pin";
import type { Env } from "./env";

export const MAX_JSON_BYTES = 200_000;

// Browsers only need CORS from a page on another origin. The app calls its own origin, and the
// mobile app is native, so it sends no Origin and ignores CORS. Anything else gets no ACAO header.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://fair-share-trips.pages.dev",
  "https://pithelo.com",
  "https://www.pithelo.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:8788",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:8788",
]);

// API and photo responses are never documents. Nothing may load from them or frame them.
const API_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
} as const;

export function isAllowedOrigin(origin: string | null): origin is string {
  return origin !== null && ALLOWED_ORIGINS.has(origin);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204 });
}

/** Adds the security headers and the origin-checked CORS headers to an API or photo response. */
export function withApiHeaders(req: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.append("Vary", "Origin");
  const origin = req.headers.get("Origin");
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

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

const MAX_FORWARDED_IP_LENGTH = 45;

const IPV4_LITERAL = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_CHARS = /^[0-9a-fA-F:.]+$/;

function isIpLiteral(value: string): boolean {
  if (value.length > MAX_FORWARDED_IP_LENGTH) {
    return false;
  }
  if (IPV4_LITERAL.test(value)) {
    return true;
  }
  if (!value.includes(":") || !IPV6_CHARS.test(value)) {
    return false;
  }
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

// A Worker on another zone sees only Cloudflare's egress address as CF-Connecting-IP, so the
// pithelo proxy forwards the visitor's address. It is trusted only with the shared secret.
function forwardedClientIp(req: Request, env: Pick<Env, "FAIRSHARE_PROXY_SECRET">): string | undefined {
  const expected = env.FAIRSHARE_PROXY_SECRET;
  const secret = req.headers.get("X-FairShare-Proxy-Secret");
  const forwarded = req.headers.get("X-FairShare-Client-IP")?.trim();
  if (!expected || !secret || !forwarded || !timingSafeEqual(secret, expected)) {
    return undefined;
  }
  return isIpLiteral(forwarded) ? forwarded : undefined;
}

export function clientIp(req: Request, env: Pick<Env, "FAIRSHARE_PROXY_SECRET">): string {
  return forwardedClientIp(req, env) ?? req.headers.get("CF-Connecting-IP") ?? "unknown";
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

// Rate limits key on the /64, since one household or host controls a whole /64.
export function clientKey(req: Request, env: Pick<Env, "FAIRSHARE_PROXY_SECRET">): string {
  const ip = clientIp(req, env).toLowerCase();
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
