import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDataStorage, configureStorage, memoryTokenStore } from "../src/api/storage";
import {
  discardPhotoUpload,
  enqueuePhotoUpload,
  flushPhotoQueue,
  pendingPhotoUploads,
  removePhotoUpload,
} from "../src/api/photoQueue";

const tripId = "ff4765be974564a2503e8f94f67538dd";
const photoId = "ab".repeat(16);

beforeEach(() => {
  configureStorage(memoryTokenStore());
  configureDataStorage(memoryTokenStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function upload(overrides: Partial<{ tripId: string; photoId: string; originalUri: string | null }> = {}) {
  return {
    tripId: overrides.tripId ?? tripId,
    photoId: overrides.photoId ?? photoId,
    displayUri: "file:///tmp/display.jpg",
    displayName: "photo.jpg",
    displayType: "image/jpeg",
    originalUri: overrides.originalUri ?? "file:///tmp/original.jpg",
    originalName: "original.jpg",
    originalType: "image/jpeg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("photoQueue", () => {
  it("enqueues and lists pending uploads per trip", async () => {
    await enqueuePhotoUpload(upload());
    await enqueuePhotoUpload(upload({ photoId: "cd".repeat(16) }));
    await enqueuePhotoUpload(upload({ tripId: "aa".repeat(16) }));

    const pending = await pendingPhotoUploads(tripId);
    expect(pending).toHaveLength(2);
  });

  it("removes a single queued upload", async () => {
    await enqueuePhotoUpload(upload());
    await removePhotoUpload(tripId, photoId);
    expect(await pendingPhotoUploads(tripId)).toHaveLength(0);
  });

  it("discards a queued upload (staged cleanup is best-effort)", async () => {
    await enqueuePhotoUpload(upload());
    await discardPhotoUpload(tripId, photoId);
    expect(await pendingPhotoUploads(tripId)).toHaveLength(0);
  });

  it("flushes queued uploads and clears the queue on success", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            photo: {
              id: photoId,
              createdAt: "t",
              displayUrl: "/x",
              thumbUrl: "/x",
              originalUrl: null,
            },
          }),
          { status: 201 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await enqueuePhotoUpload(upload());
    await enqueuePhotoUpload(upload({ photoId: "cd".repeat(16) }));

    const count = await flushPhotoQueue();
    expect(count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await pendingPhotoUploads(tripId)).toHaveLength(0);
  });

  it("keeps the queue when the upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "offline" }), { status: 500 })),
    );
    await enqueuePhotoUpload(upload());
    const count = await flushPhotoQueue();
    expect(count).toBe(0);
    expect(await pendingPhotoUploads(tripId)).toHaveLength(1);
  });

  it("stops at the first item on network failure without burning attempts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Network request failed")),
    );
    await enqueuePhotoUpload(upload());
    await enqueuePhotoUpload(upload({ photoId: "cd".repeat(16) }));
    const count = await flushPhotoQueue();
    expect(count).toBe(0);
    const pending = await pendingPhotoUploads(tripId);
    expect(pending).toHaveLength(2);
    expect(pending.every((item) => (item.attempts ?? 0) === 0)).toBe(true);
  });

  it("continues past a permanently failing item and drops it after max attempts", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        // First queued item always fails with a server rejection; the rest succeed.
        if (calls % 2 === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: "bad photo" }), { status: 400 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ photo: { id: "cd".repeat(16), createdAt: "t", displayUrl: "/x", thumbUrl: "/x", originalUrl: null } }),
            { status: 201 },
          ),
        );
      }),
    );
    await enqueuePhotoUpload(upload());
    await enqueuePhotoUpload(upload({ photoId: "cd".repeat(16) }));

    // First flush: item 1 fails (attempt 1), item 2 uploads.
    expect(await flushPhotoQueue()).toBe(1);
    let pending = await pendingPhotoUploads(tripId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);

    // Four more flushes exhaust the poisoned item's attempts; it is dropped.
    for (let i = 0; i < 4; i++) {
      await flushPhotoQueue();
    }
    pending = await pendingPhotoUploads(tripId);
    expect(pending).toHaveLength(0);
  });
});
