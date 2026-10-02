import { describe, expect, it } from "vitest";
import { listAllPhotoKeys, listPhotos } from "../../pages/functions/_shared/stores";
import { makeFakeEnv } from "./helpers/fakeEnv";

const tripId = "66666666666666666666666666666666";
const ids = ["a1", "b2", "c3"].map((p) => p.padEnd(32, "0"));

function seed(photos: ReturnType<typeof makeFakeEnv>["photos"]): void {
  for (const id of ids) {
    photos.set(`${tripId}/${id}`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: "2026-01-01T00:00:00.000Z", hasOriginal: "1" },
      uploaded: new Date("2026-05-05T00:00:00Z"),
    });
    photos.set(`${tripId}/${id}/original`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: "2026-01-01T00:00:00.000Z" },
      uploaded: new Date("2026-05-05T00:00:00Z"),
    });
  }
}

describe("R2 listing", () => {
  it("listPhotos asks R2 for customMetadata (hasOriginal, uploadedAt)", async () => {
    const { env, photos } = makeFakeEnv();
    seed(photos);
    const listed = await listPhotos(env, tripId);
    expect(listed.every((p) => p.hasOriginal)).toBe(true);
    expect(listed.every((p) => p.uploadedAt === "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("listPhotos follows the cursor across pages", async () => {
    const { env, photos } = makeFakeEnv({ r2PageSize: 2 });
    seed(photos);
    expect((await listPhotos(env, tripId)).map((p) => p.photoId)).toEqual(ids);
  });

  it("listAllPhotoKeys reads uploadedAt from customMetadata", async () => {
    const { env, photos } = makeFakeEnv({ r2PageSize: 2 });
    seed(photos);
    const keys = await listAllPhotoKeys(env);
    expect(keys).toHaveLength(6);
    expect(keys.every((k) => k.uploadedAt === "2026-01-01T00:00:00.000Z")).toBe(true);
  });
});
