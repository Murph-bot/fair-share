import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@fairshare/domain/trip";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { handlePhotoRequest } from "../../pages/functions/uploads/photos/[tripId]/[photoId]";
import { makeFakeEnv } from "./helpers/fakeEnv";

const tripId = "99999999999999999999999999999999";
const photoId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function setup() {
  const fake = makeFakeEnv();
  fake.trips.set(tripId, createTrip("Open"));
  fake.photos.set(`${tripId}/${photoId}`, {
    data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
    metadata: { contentType: "image/jpeg" },
    uploaded: new Date(),
  });
  return fake;
}

describe("photo object IO", () => {
  it("DELETE checks existence with head(), not a full download", async () => {
    const { env } = setup();
    const get = vi.spyOn(env.FAIRSHARE_PHOTOS, "get");
    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${tripId}/photos/${photoId}`, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(get).not.toHaveBeenCalled();
  });

  it("serving streams the R2 body instead of buffering it", async () => {
    const { env } = setup();
    const realGet = env.FAIRSHARE_PHOTOS.get.bind(env.FAIRSHARE_PHOTOS);
    const arrayBuffer = vi.fn();
    env.FAIRSHARE_PHOTOS.get = async (key: string) => {
      const obj = await realGet(key);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      return { ...obj, arrayBuffer, body: new Blob([bytes]).stream() };
    };
    const res = await handlePhotoRequest(
      new Request(`https://example.com/uploads/photos/${tripId}/${photoId}`),
      env,
      tripId,
      photoId,
    );
    expect(res.status).toBe(200);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  });
});
