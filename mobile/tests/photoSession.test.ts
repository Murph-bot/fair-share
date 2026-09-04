import { afterEach, describe, expect, it } from "vitest";

import {
  clearPhotoToken,
  configurePhotoSessionStore,
  loadPhotoToken,
  memoryTokenStore,
  savePhotoToken,
} from "../src/api/photoSession";

const tripA = "aa".repeat(16);
const tripB = "bb".repeat(16);

afterEach(() => {
  configurePhotoSessionStore(memoryTokenStore());
});

describe("photoSession", () => {
  it("stores tokens per trip", async () => {
    configurePhotoSessionStore(memoryTokenStore());
    await savePhotoToken(tripA, "token-a");
    await savePhotoToken(tripB, "token-b");
    await expect(loadPhotoToken(tripA)).resolves.toBe("token-a");
    await expect(loadPhotoToken(tripB)).resolves.toBe("token-b");
  });

  it("clears a stored token", async () => {
    configurePhotoSessionStore(memoryTokenStore());
    await savePhotoToken(tripA, "token-a");
    await clearPhotoToken(tripA);
    await expect(loadPhotoToken(tripA)).resolves.toBeUndefined();
  });

  it("swallows store failures", async () => {
    configurePhotoSessionStore({
      getItem: async () => {
        throw new Error("denied");
      },
      setItem: async () => {
        throw new Error("denied");
      },
      removeItem: async () => {
        throw new Error("denied");
      },
    });
    await expect(savePhotoToken(tripA, "token-a")).resolves.toBeUndefined();
    await expect(loadPhotoToken(tripA)).resolves.toBeUndefined();
    await expect(clearPhotoToken(tripA)).resolves.toBeUndefined();
  });
});
