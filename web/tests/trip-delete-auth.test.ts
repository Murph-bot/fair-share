import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, hashPin } from "@fairshare/domain/pin";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv, TEST_PEPPER, type FakePhoto } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const tripId = "22222222222222222222222222222222";
const photoId = "33333333333333333333333333333333";

describe("DELETE /api/trips/:id with a photo PIN", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let photos: Map<string, FakePhoto>;

  beforeEach(async () => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    photos = fake.photos;
    trips.set(tripId, {
      name: "Locked Trip",
      people: ["Alice"],
      expenses: [],
      pin_hash: await hashPin("123456", tripId, TEST_PEPPER),
    });
    photos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });
  });

  it("returns 401 and keeps trip and photos without the photos session", async () => {
    const res = await handleApiRequest(new Request(`https://example.com/api/trips/${tripId}`, { method: "DELETE" }), env);
    expect(res.status).toBe(401);
    expect(trips.has(tripId)).toBe(true);
    expect(photos.size).toBe(1);
  });

  it("deletes trip and photos with a valid photos session", async () => {
    const token = await createSessionToken(tripId, TEST_PEPPER);
    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${tripId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(trips.has(tripId)).toBe(false);
    expect(photos.size).toBe(0);
  });

  it("still deletes an unlocked trip without a token", async () => {
    trips.set(tripId, { name: "Open", people: ["A"], expenses: [] });
    const res = await handleApiRequest(new Request(`https://example.com/api/trips/${tripId}`, { method: "DELETE" }), env);
    expect(res.status).toBe(204);
  });
});
