import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configurePhotoSessionStore, memoryTokenStore, savePhotoToken } from "../src/api/photoSession";
import {
  absolutePhotoUrl,
  deletePhoto,
  fetchPhotos,
  lockTripPhotos,
  signOriginalUpload,
  unlockPhotos,
  uploadPhoto,
} from "../src/api/photoApi";

const tripId = "ff4765be974564a2503e8f94f67538dd";
const photoId = "ab".repeat(16);

function mockJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

beforeEach(() => {
  configurePhotoSessionStore(memoryTokenStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("absolutePhotoUrl", () => {
  it("prefixes relative display and thumb URLs", () => {
    expect(absolutePhotoUrl("/uploads/photos/a/b")).toBe(
      "https://fair-share-trips.netlify.app/uploads/photos/a/b",
    );
    expect(absolutePhotoUrl("/.netlify/images?url=%2Fuploads%2Fphotos%2Fa%2Fb")).toBe(
      "https://fair-share-trips.netlify.app/.netlify/images?url=%2Fuploads%2Fphotos%2Fa%2Fb",
    );
  });

  it("leaves Cloudinary originals unchanged", () => {
    const original = "https://res.cloudinary.com/demo/image/authenticated/s--x--/v1/fairshare/a/b.jpg";
    expect(absolutePhotoUrl(original)).toBe(original);
  });
});

describe("photoApi", () => {
  it("unlocks photos and stores the session token", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse({ token: "session-token" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(unlockPhotos(tripId, "123456")).resolves.toBe("session-token");
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://fair-share-trips.netlify.app/api/trips/${tripId}/session`,
      expect.objectContaining({ method: "POST" }),
    );
    const { loadPhotoToken } = await import("../src/api/photoSession");
    await expect(loadPhotoToken(tripId)).resolves.toBe("session-token");
  });

  it("surfaces a wrong PIN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({ error: "Wrong PIN" }, { status: 401 })));
    await expect(unlockPhotos(tripId, "000000")).rejects.toThrow("Wrong PIN");
  });

  it("sends the stored bearer token when listing photos", async () => {
    await savePhotoToken(tripId, "session-token");
    const photo = {
      id: photoId,
      createdAt: "2026-01-01T00:00:00.000Z",
      displayUrl: `/uploads/photos/${tripId}/${photoId}`,
      thumbUrl: `/.netlify/images?url=%2Fuploads%2Fphotos%2F${tripId}%2F${photoId}`,
      originalUrl: null,
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse({ photos: [photo] }));
    vi.stubGlobal("fetch", fetchSpy);

    const photos = await fetchPhotos(tripId);
    expect(photos[0]?.displayUrl).toBe(`https://fair-share-trips.netlify.app/uploads/photos/${tripId}/${photoId}`);
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
  });

  it("uploads a jpeg with optional original metadata", async () => {
    const photo = {
      id: photoId,
      createdAt: "2026-01-01T00:00:00.000Z",
      displayUrl: `/uploads/photos/${tripId}/${photoId}`,
      thumbUrl: `/uploads/photos/${tripId}/${photoId}`,
      originalUrl: null,
    };
    const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse({ photo }));
    vi.stubGlobal("fetch", fetchSpy);

    await uploadPhoto(tripId, new Blob(["jpeg"], { type: "image/jpeg" }), {
      photoId,
      cloudinaryId: `fairshare/${tripId}/${photoId}`,
    });
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    expect(options?.method).toBe("POST");
    const body = options?.body as FormData;
    expect(body.get("photo_id")).toBe(photoId);
    expect(body.get("cloudinary_id")).toBe(`fairshare/${tripId}/${photoId}`);
  });

  it("deletes a photo", async () => {
    await savePhotoToken(tripId, "session-token");
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    await deletePhoto(tripId, photoId);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://fair-share-trips.netlify.app/api/trips/${tripId}/photos/${photoId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("locks photos and stores the issued token", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ pin: "654321", photos_token: "lock-token" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(lockTripPhotos(tripId, "654321")).resolves.toEqual({
      pin: "654321",
      photos_token: "lock-token",
    });
    const { loadPhotoToken } = await import("../src/api/photoSession");
    await expect(loadPhotoToken(tripId)).resolves.toBe("lock-token");
  });

  it("rejects an incomplete original sign response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse({ photoId })));
    await expect(signOriginalUpload(tripId)).rejects.toThrow("Could not prepare original upload");
  });
});
