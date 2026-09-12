import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PHOTOS_PER_TRIP } from "@fairshare/domain/photos";
import { createSessionToken, hashPin } from "@fairshare/domain/pin";
import { deletePhoto, uploadPhoto } from "../src/api";
import { handleApiRequest } from "../../pages/functions/api/[[path]]";
import { makeFakeEnv, TEST_PEPPER } from "./helpers/fakeEnv";
import type { Env } from "../../pages/functions/_shared/env";

const validTripId = "11111111111111111111111111111111";
const validPhotoId = "22222222222222222222222222222222";

function fakeJpeg(bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

describe("DELETE /api/trips/:id/photos/:photoId", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let photos: Map<string, { data: Uint8Array; metadata: Record<string, string>; uploaded: Date }>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    photos = fake.photos;
  });

  it("returns 404 if trip not found", async () => {
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 if photoId is invalid", async () => {
    trips.set(validTripId, { name: "Test Trip", people: ["Alice"], expenses: [] });
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/invalid-id`, {
      method: "DELETE",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("returns 401 if trip has PIN and request has no session token", async () => {
    const pinHash = await hashPin("123456", validTripId, TEST_PEPPER);
    trips.set(validTripId, {
      name: "Locked Trip",
      people: ["Alice"],
      expenses: [],
      pin_hash: pinHash,
    });
    photos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 404 if photo does not exist in store", async () => {
    trips.set(validTripId, { name: "Test Trip", people: ["Alice"], expenses: [] });
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(404);
  });

  it("deletes photo blob and returns 200 when authorized", async () => {
    const pinHash = await hashPin("123456", validTripId, TEST_PEPPER);
    trips.set(validTripId, {
      name: "Locked Trip",
      people: ["Alice"],
      expenses: [],
      pin_hash: pinHash,
    });
    photos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });

    const token = await createSessionToken(validTripId, TEST_PEPPER);
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(photos.has(`${validTripId}/${validPhotoId}`)).toBe(false);
  });

  it("allows deletion without token if trip has no PIN configured (unprotected trip)", async () => {
    trips.set(validTripId, {
      name: "Open Trip",
      people: ["Alice"],
      expenses: [],
    });
    photos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handleApiRequest(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(photos.has(`${validTripId}/${validPhotoId}`)).toBe(false);
  });

  it("frees a slot toward MAX_PHOTOS_PER_TRIP when a photo is deleted", async () => {
    trips.set(validTripId, { name: "Full Trip", people: ["Alice"], expenses: [] });

    // Populate MAX_PHOTOS_PER_TRIP photos
    for (let i = 0; i < MAX_PHOTOS_PER_TRIP; i++) {
      const pId = i.toString(16).padStart(32, "0");
      photos.set(`${validTripId}/${pId}`, {
        data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
        uploaded: new Date(),
      });
    }

    // Try to upload one more via POST — should fail with 400
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");
    const postReq = new Request(`https://example.com/api/trips/${validTripId}/photos`, {
      method: "POST",
      body: formData,
    });
    const postRes = await handleApiRequest(postReq, env);
    expect(postRes.status).toBe(400);

    // Delete one photo
    const firstPhotoId = (0).toString(16).padStart(32, "0");
    const deleteReq = new Request(
      `https://example.com/api/trips/${validTripId}/photos/${firstPhotoId}`,
      { method: "DELETE" },
    );
    const delRes = await handleApiRequest(deleteReq, env);
    expect(delRes.status).toBe(200);

    // Now POST again — should succeed with 201
    const postReq2 = new Request(`https://example.com/api/trips/${validTripId}/photos`, {
      method: "POST",
      body: formData,
    });
    const postRes2 = await handleApiRequest(postReq2, env);
    expect(postRes2.status).toBe(201);
  });
});

describe("deletePhoto client API", () => {
  it("calls DELETE /api/trips/:id/photos/:photoId and handles success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deletePhoto(validTripId, validPhotoId);

    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
      headers: {},
    });
    vi.unstubAllGlobals();
  });

  it("includes Authorization header when session token is present", async () => {
    const mockStorage: Record<string, string> = {
      [`fairshare.photos.token.${validTripId}`]: "test-session-token",
    };
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deletePhoto(validTripId, validPhotoId);

    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test-session-token",
      },
    });
    vi.unstubAllGlobals();
  });

  it("throws error if delete response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Photo not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deletePhoto(validTripId, validPhotoId)).rejects.toThrow("Photo not found");
    vi.unstubAllGlobals();
  });
});

describe("POST /api/trips/:id/photos with R2 originals", () => {
  let env: Env;
  let trips: Map<string, unknown>;
  let photos: Map<string, { data: Uint8Array; metadata: Record<string, string>; uploaded: Date }>;

  beforeEach(() => {
    const fake = makeFakeEnv();
    env = fake.env;
    trips = fake.trips;
    photos = fake.photos;
  });

  it("uploads a display copy and stores it in R2", async () => {
    trips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");
    formData.append("photo_id", validPhotoId);

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      photo: { id: string; displayUrl: string; thumbUrl: string; originalUrl: string | null };
    };
    expect(body.photo.id).toBe(validPhotoId);
    expect(body.photo.displayUrl).toBe(`/uploads/photos/${validTripId}/${validPhotoId}`);
    expect(body.photo.thumbUrl).toBe(body.photo.displayUrl);
    expect(body.photo.originalUrl).toBeNull();
    expect(photos.has(`${validTripId}/${validPhotoId}`)).toBe(true);
    expect(photos.has(`${validTripId}/${validPhotoId}/original`)).toBe(false);
  });

  it("stores the full-res original in R2 and exposes an originalUrl", async () => {
    trips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");
    formData.append("original", fakeJpeg(), "original.jpg");
    formData.append("photo_id", validPhotoId);

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { photo: { originalUrl: string } };
    expect(body.photo.originalUrl).toBe(
      `/uploads/photos/${validTripId}/${validPhotoId}?original=1`,
    );
    expect(photos.has(`${validTripId}/${validPhotoId}/original`)).toBe(true);
  });

  it("returns 401 on a locked trip without a session token", async () => {
    const pinHash = await hashPin("123456", validTripId, TEST_PEPPER);
    trips.set(validTripId, { name: "Locked", people: ["Alice"], expenses: [], pin_hash: pinHash });
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a photo_id that does not look like an id", async () => {
    trips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");
    formData.append("photo_id", "not-an-id");

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects duplicate photo ids", async () => {
    trips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    photos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      metadata: { uploadedAt: new Date().toISOString(), hasOriginal: "0" },
      uploaded: new Date(),
    });
    const formData = new FormData();
    formData.append("photo", fakeJpeg(), "test.jpg");
    formData.append("photo_id", validPhotoId);

    const res = await handleApiRequest(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("originals client API", () => {
  it("uploadPhoto sends the original part when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          photo: {
            id: validPhotoId,
            createdAt: "t",
            displayUrl: "/x",
            thumbUrl: "/y",
            originalUrl: null,
          },
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const original = new Blob(["orig"], { type: "image/jpeg" });
    await uploadPhoto(validTripId, new Blob(["x"]), { original });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("original")).toBeInstanceOf(Blob);
    vi.unstubAllGlobals();
  });
});
