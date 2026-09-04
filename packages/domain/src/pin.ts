const encoder = new TextEncoder();

export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PHOTO_URL_TTL_SECONDS = 60 * 60;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return bytesToHex(digest);
}

async function hmacHex(pepper: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(sig);
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function generatePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function hashPin(pin: string, tripId: string, pepper: string): Promise<string> {
  return sha256Hex(`${pepper}:${tripId}:${pin}`);
}

export async function pinMatches(
  pin: string,
  tripId: string,
  pepper: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPin(pin, tripId, pepper);
  return timingSafeEqual(actual, expectedHash);
}

export async function createSessionToken(
  tripId: string,
  pepper: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const exp = nowSeconds + TOKEN_TTL_SECONDS;
  const sig = await hmacHex(pepper, `session:${tripId}:${exp}`);
  return `v1.${tripId}.${exp}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  tripId: string,
  pepper: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return false;
  }
  const [, tokenTrip, expRaw, sig] = parts;
  if (tokenTrip !== tripId) {
    return false;
  }
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp < nowSeconds) {
    return false;
  }
  const expected = await hmacHex(pepper, `session:${tripId}:${exp}`);
  return timingSafeEqual(sig, expected);
}

export async function signPhotoAccess(
  tripId: string,
  photoId: string,
  pepper: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ exp: number; sig: string }> {
  const exp = nowSeconds + PHOTO_URL_TTL_SECONDS;
  const sig = await hmacHex(pepper, `photo:${tripId}:${photoId}:${exp}`);
  return { exp, sig };
}

export async function verifyPhotoAccess(
  tripId: string,
  photoId: string,
  pepper: string,
  expRaw: string,
  sig: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp) || exp < nowSeconds) {
    return false;
  }
  const expected = await hmacHex(pepper, `photo:${tripId}:${photoId}:${exp}`);
  return timingSafeEqual(sig, expected);
}

export function normalizePin(raw: string): string | undefined {
  const pin = raw.trim();
  if (!/^\d{6}$/.test(pin)) {
    return undefined;
  }
  return pin;
}
