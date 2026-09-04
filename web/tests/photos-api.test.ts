import type { Context } from "@netlify/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PHOTOS_PER_TRIP } from "@fairshare/domain/photos";
import { createSessionToken, hashPin } from "@fairshare/domain/pin";
import { deletePhoto, signOriginalUpload, uploadPhoto } from "../src/api";
import { uploadOriginalToCloudinary } from "../src/cloudinary-upload";
import { cloudinaryPublicId } from "@fairshare/domain/cloudinary";

const mockTrips = new Map<string, any>();
const mockPhotos = new Map<string, { data: Uint8Array; metadata: any }>();

vi.mock("../../netlify/functions/_shared/stores", () => ({
  tripsStore: () => ({
    get: async (key: string) => mockTrips.get(key) ?? null,
    set: async (key: string, value: any) => {
      mockTrips.set(key, value);
    },
  }),
  photosStore: () => ({
    get: async (key: string) => mockPhotos.get(key)?.data ?? null,
    getMetadata: async (key: string) => {
      const p = mockPhotos.get(key);
      return p ? { etag: "1", metadata: p.metadata } : null;
    },
    list: async (opts?: { prefix?: string }) => {
      const keys = Array.from(mockPhotos.keys());
      const prefix = opts?.prefix;
      const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
      return { blobs: filtered.map((k) => ({ key: k, etag: "1" })) };
    },
    set: async (key: string, buffer: Uint8Array, opts?: any) => {
      mockPhotos.set(key, { data: buffer, metadata: opts?.metadata ?? {} });
    },
    delete: async (key: string) => {
      mockPhotos.delete(key);
    },
  }),
  pinAttemptsStore: () => ({
    get: async () => null,
    set: async () => {},
  }),
}));

// Import handler after mocks
import handler from "../../netlify/functions/photos";

const PEPPER = "test-pepper-for-testing-only-1234";
process.env.PHOTO_PIN_PEPPER = PEPPER;

const validTripId = "11111111111111111111111111111111";
const validPhotoId = "22222222222222222222222222222222";

function makeContext(params: Record<string, string>): Context {
  return {
    params,
  } as unknown as Context;
}

describe("DELETE /api/trips/:id/photos/:photoId", () => {
  beforeEach(() => {
    mockTrips.clear();
    mockPhotos.clear();
  });

  it("returns 404 if trip not found", async () => {
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: validPhotoId }));
    expect(res.status).toBe(404);
  });

  it("returns 404 if photoId is invalid", async () => {
    mockTrips.set(validTripId, { name: "Test Trip", people: ["Alice"], expenses: [] });
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/invalid-id`, {
      method: "DELETE",
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: "invalid-id" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 if trip has PIN and request has no session token", async () => {
    const pinHash = await hashPin("123456", validTripId, PEPPER);
    mockTrips.set(validTripId, {
      name: "Locked Trip",
      people: ["Alice"],
      expenses: [],
      pin_hash: pinHash,
    });
    mockPhotos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString() },
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: validPhotoId }));
    expect(res.status).toBe(401);
  });

  it("returns 404 if photo does not exist in store", async () => {
    mockTrips.set(validTripId, { name: "Test Trip", people: ["Alice"], expenses: [] });
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: validPhotoId }));
    expect(res.status).toBe(404);
  });

  it("deletes photo blob and returns 200 when authorized", async () => {
    const pinHash = await hashPin("123456", validTripId, PEPPER);
    mockTrips.set(validTripId, {
      name: "Locked Trip",
      people: ["Alice"],
      expenses: [],
      pin_hash: pinHash,
    });
    mockPhotos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString() },
    });

    const token = await createSessionToken(validTripId, PEPPER);
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: validPhotoId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPhotos.has(`${validTripId}/${validPhotoId}`)).toBe(false);
  });

  it("allows deletion without token if trip has no PIN configured (unprotected trip)", async () => {
    mockTrips.set(validTripId, {
      name: "Open Trip",
      people: ["Alice"],
      expenses: [],
    });
    mockPhotos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      metadata: { uploadedAt: new Date().toISOString() },
    });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
      method: "DELETE",
    });
    const res = await handler(req, makeContext({ id: validTripId, photoId: validPhotoId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPhotos.has(`${validTripId}/${validPhotoId}`)).toBe(false);
  });

  it("frees a slot toward MAX_PHOTOS_PER_TRIP when a photo is deleted", async () => {
    mockTrips.set(validTripId, { name: "Full Trip", people: ["Alice"], expenses: [] });

    // Populate MAX_PHOTOS_PER_TRIP photos
    for (let i = 0; i < MAX_PHOTOS_PER_TRIP; i++) {
      const pId = i.toString(16).padStart(32, "0");
      mockPhotos.set(`${validTripId}/${pId}`, {
        data: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        metadata: { uploadedAt: new Date().toISOString() },
      });
    }

    // Try to upload one more via POST — should fail with 400
    const formData = new FormData();
    const fakeJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], {
      type: "image/jpeg",
    });
    formData.append("photo", fakeJpeg, "test.jpg");
    const postReq = new Request(`https://example.com/api/trips/${validTripId}/photos`, {
      method: "POST",
      body: formData,
    });
    const postRes = await handler(postReq, makeContext({ id: validTripId }));
    expect(postRes.status).toBe(400);

    // Delete one photo
    const firstPhotoId = (0).toString(16).padStart(32, "0");
    const deleteReq = new Request(
      `https://example.com/api/trips/${validTripId}/photos/${firstPhotoId}`,
      { method: "DELETE" },
    );
    const delRes = await handler(deleteReq, makeContext({ id: validTripId, photoId: firstPhotoId }));
    expect(delRes.status).toBe(200);

    // Now POST again — should succeed with 201
    const postReq2 = new Request(`https://example.com/api/trips/${validTripId}/photos`, {
      method: "POST",
      body: formData,
    });
    const postRes2 = await handler(postReq2, makeContext({ id: validTripId }));
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

describe("POST /api/trips/:id/photos/sign", () => {
  beforeEach(() => {
    mockTrips.clear();
    mockPhotos.clear();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it("returns 401 without a session token on a locked trip", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "1234";
    process.env.CLOUDINARY_API_SECRET = "abcd";
    const pinHash = await hashPin("123456", validTripId, PEPPER);
    mockTrips.set(validTripId, { name: "Locked", people: ["Alice"], expenses: [], pin_hash: pinHash });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/sign`, {
      method: "POST",
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when Cloudinary is not configured", async () => {
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/sign`, {
      method: "POST",
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(503);
  });

  it("returns a signed upload payload for an unlocked trip", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "1234";
    process.env.CLOUDINARY_API_SECRET = "abcd";
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/sign`, {
      method: "POST",
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photoId).toMatch(/^[a-f0-9]{32}$/);
    expect(body.cloudName).toBe("demo");
    expect(body.apiKey).toBe("1234");
    expect(body.folder).toBe(`fairshare/${validTripId}`);
    expect(body.publicId).toBe(body.photoId);
    expect(body.type).toBe("authenticated");
    expect(body.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(body.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(typeof body.timestamp).toBe("number");
    expect(JSON.stringify(body)).not.toContain("abcd");
  });

  it("returns a signed upload payload for a locked trip with a valid session token", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "1234";
    process.env.CLOUDINARY_API_SECRET = "abcd";
    const pinHash = await hashPin("123456", validTripId, PEPPER);
    mockTrips.set(validTripId, { name: "Locked", people: ["Alice"], expenses: [], pin_hash: pinHash });
    const token = await createSessionToken(validTripId, PEPPER);

    const req = new Request(`https://example.com/api/trips/${validTripId}/photos/sign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await handler(req, makeContext({ id: validTripId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photoId).toMatch(/^[a-f0-9]{32}$/);
    expect(body.signature).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe("originals on display blobs", () => {
  beforeEach(() => {
    mockTrips.clear();
    mockPhotos.clear();
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "1234";
    process.env.CLOUDINARY_API_SECRET = "abcd";
  });

  it("persists cloudinaryId on upload and returns a signed originalUrl on list", async () => {
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const formData = new FormData();
    formData.append(
      "photo",
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], { type: "image/jpeg" }),
      "test.jpg",
    );
    formData.append("photo_id", validPhotoId);
    formData.append("cloudinary_id", cloudinaryPublicId(validTripId, validPhotoId));

    const postRes = await handler(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      makeContext({ id: validTripId }),
    );
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    expect(created.photo.id).toBe(validPhotoId);
    expect(created.photo.originalUrl).toContain("api.cloudinary.com");
    expect(created.photo.originalUrl).toContain("signature=");

    const stored = mockPhotos.get(`${validTripId}/${validPhotoId}`);
    expect(stored?.metadata.cloudinaryId).toBe(cloudinaryPublicId(validTripId, validPhotoId));

    const listRes = await handler(
      new Request(`https://example.com/api/trips/${validTripId}/photos`),
      makeContext({ id: validTripId }),
    );
    const list = await listRes.json();
    expect(list.photos[0].originalUrl).toContain(`/v1_1/demo/image/download`);
    expect(list.photos[0].originalUrl).not.toContain("abcd");
  });

  it("rejects a cloudinary_id that does not belong to this photo", async () => {
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    const formData = new FormData();
    formData.append(
      "photo",
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], { type: "image/jpeg" }),
      "test.jpg",
    );
    formData.append("photo_id", validPhotoId);
    formData.append("cloudinary_id", "fairshare/other/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const res = await handler(
      new Request(`https://example.com/api/trips/${validTripId}/photos`, {
        method: "POST",
        body: formData,
      }),
      makeContext({ id: validTripId }),
    );
    expect(res.status).toBe(400);
  });

  it("keeps originalUrl null when no original was attached", async () => {
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    mockPhotos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      metadata: { uploadedAt: new Date().toISOString() },
    });

    const listRes = await handler(
      new Request(`https://example.com/api/trips/${validTripId}/photos`),
      makeContext({ id: validTripId }),
    );
    const list = await listRes.json();
    expect(list.photos[0].originalUrl).toBeNull();
  });

  it("destroys the Cloudinary original when deleting a photo", async () => {
    mockTrips.set(validTripId, { name: "Trip", people: ["Alice"], expenses: [] });
    mockPhotos.set(`${validTripId}/${validPhotoId}`, {
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      metadata: {
        uploadedAt: new Date().toISOString(),
        cloudinaryId: cloudinaryPublicId(validTripId, validPhotoId),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler(
      new Request(`https://example.com/api/trips/${validTripId}/photos/${validPhotoId}`, {
        method: "DELETE",
      }),
      makeContext({ id: validTripId, photoId: validPhotoId }),
    );
    expect(res.status).toBe(200);
    expect(mockPhotos.has(`${validTripId}/${validPhotoId}`)).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("/image/destroy");
    vi.unstubAllGlobals();
  });
});

describe("originals client API", () => {
  it("signOriginalUpload posts to /photos/sign", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          photoId: validPhotoId,
          timestamp: 1,
          signature: "aa",
          apiKey: "1234",
          cloudName: "demo",
          folder: `fairshare/${validTripId}`,
          publicId: validPhotoId,
          type: "authenticated",
          uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
          maxFileSize: 15_000_000,
          allowedFormats: "jpg,jpeg,png,heic,heif",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await signOriginalUpload(validTripId);
    expect(result.photoId).toBe(validPhotoId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${validTripId}/photos/sign`, {
      method: "POST",
      headers: {},
    });
    vi.unstubAllGlobals();
  });

  it("uploadPhoto sends photo_id and cloudinary_id when provided", async () => {
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
    await uploadPhoto(validTripId, new Blob(["x"]), {
      photoId: validPhotoId,
      cloudinaryId: cloudinaryPublicId(validTripId, validPhotoId),
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("photo_id")).toBe(validPhotoId);
    expect(body.get("cloudinary_id")).toBe(cloudinaryPublicId(validTripId, validPhotoId));
    vi.unstubAllGlobals();
  });

  it("uploadOriginalToCloudinary posts the signed fields to Cloudinary and returns public_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ public_id: cloudinaryPublicId(validTripId, validPhotoId) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const publicId = await uploadOriginalToCloudinary(new File(["orig"], "orig.jpg", { type: "image/jpeg" }), {
      photoId: validPhotoId,
      timestamp: 1,
      signature: "aa",
      apiKey: "1234",
      cloudName: "demo",
      folder: `fairshare/${validTripId}`,
      publicId: validPhotoId,
      type: "authenticated",
      uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
      maxFileSize: 15_000_000,
      allowedFormats: "jpg,jpeg,png,heic,heif",
    });
    expect(publicId).toBe(cloudinaryPublicId(validTripId, validPhotoId));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    const sent = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(sent.get("signature")).toBe("aa");
    expect(sent.get("type")).toBe("authenticated");
    expect(sent.get("public_id")).toBe(validPhotoId);
    vi.unstubAllGlobals();
  });
});
