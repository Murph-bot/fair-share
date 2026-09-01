import { describe, expect, it } from "vitest";
import { PHOTO_RETENTION_MS } from "../src/domain/photos";
import {
  createSessionToken,
  generatePin,
  hashPin,
  normalizePin,
  pinMatches,
  signPhotoAccess,
  verifyPhotoAccess,
  verifySessionToken,
} from "../src/domain/pin";

const pepper = "test-pepper-not-for-production";
const tripId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("PIN helpers", () => {
  it("generates a 6-digit PIN", () => {
    expect(generatePin()).toMatch(/^\d{6}$/);
  });

  it("hashes and verifies a PIN for a trip", async () => {
    const hash = await hashPin("123456", tripId, pepper);
    expect(await pinMatches("123456", tripId, pepper, hash)).toBe(true);
    expect(await pinMatches("000000", tripId, pepper, hash)).toBe(false);
    expect(await pinMatches("123456", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", pepper, hash)).toBe(false);
  });

  it("issues a session token bound to the trip", async () => {
    const token = await createSessionToken(tripId, pepper, 1_000_000);
    expect(await verifySessionToken(token, tripId, pepper, 1_000_000)).toBe(true);
    expect(await verifySessionToken(token, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", pepper, 1_000_000)).toBe(
      false,
    );
    expect(await verifySessionToken(token, tripId, pepper, 1_000_000 + 31 * 24 * 60 * 60)).toBe(false);
    expect(await verifySessionToken("nope", tripId, pepper, 1_000_000)).toBe(false);
  });

  it("signs photo URLs that expire", async () => {
    const { exp, sig } = await signPhotoAccess(tripId, "cccccccccccccccccccccccccccccccc", pepper, 1_000_000);
    expect(
      await verifyPhotoAccess(tripId, "cccccccccccccccccccccccccccccccc", pepper, String(exp), sig, 1_000_000),
    ).toBe(true);
    expect(
      await verifyPhotoAccess(tripId, "dddddddddddddddddddddddddddddddd", pepper, String(exp), sig, 1_000_000),
    ).toBe(false);
    expect(
      await verifyPhotoAccess(
        tripId,
        "cccccccccccccccccccccccccccccccc",
        pepper,
        String(exp),
        sig,
        exp + 1,
      ),
    ).toBe(false);
  });

  it("accepts only 6-digit PINs", () => {
    expect(normalizePin("123456")).toBe("123456");
    expect(normalizePin(" 123456 ")).toBe("123456");
    expect(normalizePin("12345")).toBeUndefined();
    expect(normalizePin("abcdef")).toBeUndefined();
  });

  it("keeps photos for one year", () => {
    expect(PHOTO_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});
