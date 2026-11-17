import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, hashPin, signPhotoAccess, verifyPhotoAccess } from "@fairshare/domain/pin";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { handlePhotoRequest } from "../../pages/functions/uploads/photos/[tripId]/[photoId]";
import { stripJpegMetadata } from "../../pages/functions/_shared/jpeg";
import { makeFakeEnv, TEST_PEPPER, type FakePhoto } from "./helpers/fakeEnv";
import { asLatin1, gpsJpeg, plainJpeg, type Bytes } from "./helpers/jpeg";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "11111111111111111111111111111111";
const photoId = "22222222222222222222222222222222";
const photoUrl = `https://example.com/uploads/photos/${tripId}/${photoId}`;

let env: Env;
let trips: Map<string, unknown>;
let photos: Map<string, FakePhoto>;

beforeEach(() => {
  const fake = makeFakeEnv();
  env = fake.env;
  trips = fake.trips;
  photos = fake.photos;
});

function storePhoto(key: string, data: Uint8Array): void {
  photos.set(key, { data, metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "1" }, uploaded: new Date() });
}

async function lockedTrip(): Promise<void> {
  trips.set(tripId, {
    name: "Locked",
    people: ["Alice"],
    expenses: [],
    pin_hash: await hashPin("123456", tripId, TEST_PEPPER),
  });
  storePhoto(`${tripId}/${photoId}`, new Uint8Array([1, 2, 3]));
  storePhoto(`${tripId}/${photoId}/original`, new Uint8Array([4, 5, 6]));
}

function upload(parts: Record<string, Bytes>, headers: Record<string, string> = {}): Request {
  const form = new FormData();
  for (const [name, bytes] of Object.entries(parts)) {
    form.append(name, new File([bytes], `${name}.jpg`, { type: "image/jpeg" }));
  }
  form.append("photo_id", photoId);
  return new Request(`https://example.com/api/trips/${tripId}/photos`, { method: "POST", body: form, headers });
}

describe("security headers", () => {
  it("sets nosniff, a locked-down CSP and Referrer-Policy on API responses", async () => {
    const res = await handleApiRequest(new Request("https://example.com/api/trips/nope"), env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("sets them on photo responses, including errors, and serves image/jpeg", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    storePhoto(`${tripId}/${photoId}`, plainJpeg());
    const ok = await handlePhotoRequest(new Request(photoUrl), env, tripId, photoId);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect(ok.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ok.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const missing = await handlePhotoRequest(new Request(`${photoUrl}?original=1`), env, tripId, photoId);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("forces image/jpeg even if stored metadata says otherwise", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    photos.set(`${tripId}/${photoId}`, {
      data: plainJpeg(),
      metadata: { contentType: "text/html", uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });
    const res = await handlePhotoRequest(new Request(photoUrl), env, tripId, photoId);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });
});

describe("CORS", () => {
  const preflight = (origin: string): Request =>
    new Request(`https://example.com/api/trips/${tripId}`, { method: "OPTIONS", headers: { Origin: origin } });

  it.each([
    "https://fair-share-trips.pages.dev",
    "https://pithelo.com",
    "http://localhost:5173",
  ])("echoes the allowed origin %s", async (origin) => {
    const res = await handleApiRequest(preflight(origin), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it.each(["https://evil.example", "https://pithelo.com.evil.example", "null"])(
    "sends no CORS headers to %s",
    async (origin) => {
      const res = await handleApiRequest(preflight(origin), env);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
    },
  );

  it("sends no CORS headers when there is no Origin, as with the native app", async () => {
    const res = await handleApiRequest(new Request("https://example.com/api/trips/nope"), env);
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("applies the same rule to photo responses", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    storePhoto(`${tripId}/${photoId}`, plainJpeg());
    const allowed = await handlePhotoRequest(
      new Request(photoUrl, { headers: { Origin: "https://pithelo.com" } }),
      env,
      tripId,
      photoId,
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://pithelo.com");
    const denied = await handlePhotoRequest(
      new Request(photoUrl, { headers: { Origin: "https://evil.example" } }),
      env,
      tripId,
      photoId,
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("signed photo URLs are scoped to a variant", () => {
  it("a display signature opens the display copy but not the original", async () => {
    await lockedTrip();
    const { exp, sig } = await signPhotoAccess(tripId, photoId, TEST_PEPPER);
    const display = await handlePhotoRequest(new Request(`${photoUrl}?exp=${exp}&sig=${sig}`), env, tripId, photoId);
    expect(display.status).toBe(200);
    const original = await handlePhotoRequest(
      new Request(`${photoUrl}?exp=${exp}&sig=${sig}&original=1`),
      env,
      tripId,
      photoId,
    );
    expect(original.status).toBe(401);
  });

  it("an original signature opens the original but not the display copy", async () => {
    await lockedTrip();
    const { exp, sig } = await signPhotoAccess(tripId, photoId, TEST_PEPPER, undefined, "original");
    const original = await handlePhotoRequest(
      new Request(`${photoUrl}?exp=${exp}&sig=${sig}&original=1`),
      env,
      tripId,
      photoId,
    );
    expect(original.status).toBe(200);
    const display = await handlePhotoRequest(new Request(`${photoUrl}?exp=${exp}&sig=${sig}`), env, tripId, photoId);
    expect(display.status).toBe(401);
  });

  it("verifyPhotoAccess rejects a signature minted for the other variant", async () => {
    const { exp, sig } = await signPhotoAccess(tripId, photoId, TEST_PEPPER, 1_000_000, "display");
    expect(await verifyPhotoAccess(tripId, photoId, TEST_PEPPER, String(exp), sig, 1_000_000, "display")).toBe(true);
    expect(await verifyPhotoAccess(tripId, photoId, TEST_PEPPER, String(exp), sig, 1_000_000, "original")).toBe(false);
  });

  it("listing a locked trip returns separately signed display and original URLs", async () => {
    await lockedTrip();
    const token = await createSessionToken(tripId, TEST_PEPPER);
    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${tripId}/photos`, { headers: { Authorization: `Bearer ${token}` } }),
      env,
    );
    const { photos: list } = (await res.json()) as { photos: Array<{ displayUrl: string; originalUrl: string }> };
    const sigOf = (url: string): string | null => new URL(url, "https://example.com").searchParams.get("sig");
    expect(sigOf(list[0].displayUrl)).not.toBeNull();
    expect(sigOf(list[0].originalUrl)).not.toBeNull();
    expect(sigOf(list[0].originalUrl)).not.toBe(sigOf(list[0].displayUrl));
    const opened = await handlePhotoRequest(new Request(`https://example.com${list[0].originalUrl}`), env, tripId, photoId);
    expect(opened.status).toBe(200);
  });
});

describe("photo metadata is stripped on upload", () => {
  it("the fixture really carries GPS and camera data", () => {
    const text = asLatin1(gpsJpeg());
    expect(text).toContain("TestCam");
    expect(text).toContain("secret comment");
    expect(text).toContain("Exif");
  });

  it("removes EXIF, GPS and comments from the stored original and display copy", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    const res = await handleApiRequest(upload({ photo: gpsJpeg(), original: gpsJpeg() }), env);
    expect(res.status).toBe(201);
    for (const key of [`${tripId}/${photoId}`, `${tripId}/${photoId}/original`]) {
      const stored = photos.get(key)?.data;
      expect(stored).toBeDefined();
      const text = asLatin1(stored as Uint8Array);
      expect(text).not.toContain("TestCam");
      expect(text).not.toContain("Model X");
      expect(text).not.toContain("secret comment");
      expect(text).not.toContain("2026:11:01");
    }
  });

  it("keeps the orientation so the photo still displays upright", () => {
    const stripped = stripJpegMetadata(gpsJpeg());
    const text = asLatin1(stripped);
    expect(text).toContain("Exif");
    // one APP1 segment of 36 bytes, orientation tag 0x0112 with value 6
    const app1 = stripped.indexOf(0xe1);
    expect(stripped[app1 - 1]).toBe(0xff);
    const view = new DataView(stripped.buffer, stripped.byteOffset + app1 + 1);
    expect(view.getUint16(0)).toBe(0x22);
    expect(Array.from(stripped.subarray(app1 + 19, app1 + 31))).toEqual([
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
    ]);
    expect(stripped.length).toBeLessThan(gpsJpeg().length);
  });

  it("copies the image data unchanged", () => {
    const plain = plainJpeg();
    expect(Array.from(stripJpegMetadata(plain))).toEqual(Array.from(plain));
  });

  it("drops trailing data after the end-of-image marker", () => {
    const withTail = new Uint8Array([...plainJpeg(), ...new TextEncoder().encode("lat=37.97 lon=23.72")]);
    expect(asLatin1(stripJpegMetadata(withTail))).not.toContain("lat=37.97");
  });

  it("rejects an upload that is not a complete JPEG", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    const truncated = plainJpeg().subarray(0, 40);
    const res = await handleApiRequest(upload({ photo: truncated }), env);
    expect(res.status).toBe(400);
    expect(photos.size).toBe(0);
  });
});
