import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_RETENTION_MS } from "@fairshare/domain/photos";
import { cloudinaryPublicId } from "@fairshare/domain/cloudinary";

const mockPhotos = new Map<string, { data: Uint8Array; metadata: any }>();

vi.mock("../../netlify/functions/_shared/stores", () => ({
  photosStore: () => ({
    getMetadata: async (key: string) => {
      const p = mockPhotos.get(key);
      return p ? { etag: "1", metadata: p.metadata } : null;
    },
    list: async () => ({
      blobs: Array.from(mockPhotos.keys()).map((k) => ({ key: k, etag: "1" })),
    }),
    delete: async (key: string) => {
      mockPhotos.delete(key);
    },
  }),
}));

import { expireDuePhotos } from "../../netlify/functions/expire-photos";

const tripId = "11111111111111111111111111111111";
const photoId = "22222222222222222222222222222222";

describe("expireDuePhotos", () => {
  beforeEach(() => {
    mockPhotos.clear();
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "1234";
    process.env.CLOUDINARY_API_SECRET = "abcd";
  });

  it("deletes expired display blobs and their Cloudinary originals", async () => {
    const old = new Date(Date.now() - PHOTO_RETENTION_MS - 1000).toISOString();
    mockPhotos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: old, cloudinaryId: cloudinaryPublicId(tripId, photoId) },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expireDuePhotos(Date.now());

    expect(mockPhotos.size).toBe(0);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/image/destroy");
    vi.unstubAllGlobals();
  });

  it("skips nested blob keys and recent photos", async () => {
    const recent = new Date().toISOString();
    mockPhotos.set(`${tripId}/${photoId}`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: recent, cloudinaryId: "should-not-delete" },
    });
    mockPhotos.set(`${tripId}/${photoId}/extra`, {
      data: new Uint8Array([1]),
      metadata: { uploadedAt: new Date(0).toISOString(), cloudinaryId: "nested" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expireDuePhotos(Date.now());

    expect(mockPhotos.has(`${tripId}/${photoId}`)).toBe(true);
    expect(mockPhotos.has(`${tripId}/${photoId}/extra`)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
