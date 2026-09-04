import { describe, expect, it } from "vitest";

import { photoAccessState, shouldOfferLockCta } from "../src/utils/photoAccess";

describe("photoAccessState", () => {
  it("locks when the trip has a PIN and no session", () => {
    expect(photoAccessState(true, false)).toBe("locked");
  });

  it("unlocks when a session token is stored", () => {
    expect(photoAccessState(true, true)).toBe("unlocked");
  });

  it("unlocks grandfathered trips", () => {
    expect(photoAccessState(false, false)).toBe("unlocked");
    expect(photoAccessState(undefined, false)).toBe("unlocked");
  });
});

describe("shouldOfferLockCta", () => {
  it("offers lock only when photos are explicitly unlocked", () => {
    expect(shouldOfferLockCta(false)).toBe(true);
    expect(shouldOfferLockCta(true)).toBe(false);
    expect(shouldOfferLockCta(undefined)).toBe(false);
  });
});
