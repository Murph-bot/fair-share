import { describe, expect, it } from "vitest";
import { createTrip } from "@fairshare/domain/trip";
import { handlePhotoRequest } from "../../pages/functions/uploads/photos/[tripId]/[photoId]";
import { makeFakeEnv } from "./helpers/fakeEnv";

const tripId = "77777777777777777777777777777777";
const photoId = "88888888888888888888888888888888";

describe("photo Cache-Control", () => {
  it("unlocked photos are not cached for a year or by shared caches (a PIN can be added later)", async () => {
    const { env, trips, photos } = makeFakeEnv();
    trips.set(tripId, createTrip("Open"));
    photos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      metadata: { contentType: "image/jpeg" },
      uploaded: new Date(),
    });
    const res = await handlePhotoRequest(
      new Request(`https://example.com/uploads/photos/${tripId}/${photoId}`),
      env,
      tripId,
      photoId,
    );
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).not.toContain("immutable");
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? "0");
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });
});
