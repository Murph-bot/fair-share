import { describe, expect, it } from "vitest";

import * as domain from "../src/domain";

describe("mobile domain boundary", () => {
  it("exports the money and trip helpers we need", () => {
    expect(typeof domain.parseTrip).toBe("function");
    expect(typeof domain.computeBalances).toBe("function");
    expect(typeof domain.settle).toBe("function");
    expect(typeof domain.centsToEuro).toBe("function");
    expect(typeof domain.parseAmount).toBe("function");
    expect(typeof domain.addExpense).toBe("function");
    expect(typeof domain.updateExpense).toBe("function");
    expect(typeof domain.removeExpense).toBe("function");
  });

  it("does not expose crypto or photo helpers", () => {
    for (const key of [
      "generatePin",
      "hashPin",
      "signPhotoAccess",
      "verifyPhotoAccess",
      "verifySessionToken",
      "createSessionToken",
      "pinMatches",
      "PHOTO_ID_RE",
      "MAX_PHOTOS_PER_TRIP",
      "MAX_ORIGINAL_BYTES",
      "cloudinaryFolder",
    ]) {
      expect(key in domain).toBe(false);
    }
  });
});

describe("mobile photos domain re-export", () => {
  it("exposes photo constants without PIN or Cloudinary signing", async () => {
    const photos = await import("../src/domain/photos");
    expect(photos.PHOTO_MAX_EDGE).toBeGreaterThan(0);
    expect(photos.MAX_PHOTO_BYTES).toBeGreaterThan(0);
    expect(photos.MAX_PHOTOS_PER_TRIP).toBeGreaterThan(0);
    expect(photos.PHOTO_ID_RE.test("a".repeat(32))).toBe(true);
    expect("generatePin" in photos).toBe(false);
    expect("hashPin" in photos).toBe(false);
    expect("cloudinaryFolder" in photos).toBe(false);
    expect("signUploadRequest" in photos).toBe(false);
  });
});
