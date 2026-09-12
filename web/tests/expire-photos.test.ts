import { beforeEach, describe, expect, it } from "vitest";
import { PHOTO_RETENTION_MS } from "@fairshare/domain/photos";
import { expireDuePhotos } from "../../pages/functions/_shared/expiry";
import { makeFakeEnv } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "11111111111111111111111111111111";
const photoId = "22222222222222222222222222222222";

describe("expireDuePhotos", () => {
  let env: Env;
  let photos: Map<string, { data: Uint8Array; metadata: Record<string, string>; uploaded: Date }>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    photos = fake.photos;
  });

  it("deletes expired display blobs together with their originals", async () => {
    const old = new Date(Date.now() - PHOTO_RETENTION_MS - 1000).toISOString();
    photos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: old, hasOriginal: "1" },
      uploaded: new Date(0),
    });
    photos.set(`${tripId}/${photoId}/original`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: old, hasOriginal: "1" },
      uploaded: new Date(0),
    });

    await expireDuePhotos(env, Date.now());

    expect(photos.size).toBe(0);
  });

  it("skips nested keys and recent photos", async () => {
    const recent = new Date().toISOString();
    photos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: recent, hasOriginal: "0" },
      uploaded: new Date(),
    });
    photos.set(`${tripId}/${photoId}/extra`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: new Date(0).toISOString(), hasOriginal: "0" },
      uploaded: new Date(0),
    });

    await expireDuePhotos(env, Date.now());

    expect(photos.has(`${tripId}/${photoId}`)).toBe(true);
    expect(photos.has(`${tripId}/${photoId}/extra`)).toBe(true);
  });
});
