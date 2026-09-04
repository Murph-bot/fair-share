import type { Config, Context } from "@netlify/functions";
import { ValidationError } from "../../packages/domain/src/errors";
import {
  CLOUDINARY_ASSET_TYPE,
  MAX_ORIGINAL_BYTES,
  ORIGINAL_ALLOWED_FORMATS,
  cloudinaryFolder,
  isValidCloudinaryId,
  signUploadRequest,
} from "../../packages/domain/src/cloudinary";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_TRIP,
  PHOTO_ID_RE,
} from "../../packages/domain/src/photos";
import { signPhotoAccess, verifySessionToken } from "../../packages/domain/src/pin";
import { newTripId, TRIP_ID_RE } from "../../packages/domain/src/trip";
import {
  destroyCloudinaryAsset,
  requireCloudinary,
  signedOriginalUrl,
} from "./_shared/cloudinary";
import {
  bearerToken,
  corsPreflight,
  errorResponse,
  json,
  pinHashFromRecord,
  pinPepper,
} from "./_shared/http";
import { photosStore, tripsStore } from "./_shared/stores";

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function requirePhotoSession(
  req: Request,
  tripId: string,
  pinHash: string | undefined,
): Promise<Response | null> {
  if (!pinHash) {
    return null;
  }
  const token = bearerToken(req);
  if (!token || !(await verifySessionToken(token, tripId, pinPepper()))) {
    return json(401, { error: "Photos PIN required" });
  }
  return null;
}

async function photoUrls(tripId: string, photoId: string, locked: boolean): Promise<{
  displayUrl: string;
  thumbUrl: string;
}> {
  const path = `/uploads/photos/${tripId}/${photoId}`;
  let displayUrl = path;
  if (locked) {
    const { exp, sig } = await signPhotoAccess(tripId, photoId, pinPepper());
    displayUrl = `${path}?exp=${exp}&sig=${sig}`;
  }
  const thumbUrl = `/.netlify/images?url=${encodeURIComponent(displayUrl)}&w=400&h=400&fit=cover`;
  return { displayUrl, thumbUrl };
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function originalUrlFromMeta(metadata: Record<string, unknown> | undefined): Promise<string | null> {
  const cloudinaryId = metadata?.cloudinaryId;
  if (typeof cloudinaryId !== "string" || !cloudinaryId) {
    return null;
  }
  return signedOriginalUrl(cloudinaryId);
}

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "OPTIONS") {
      return corsPreflight();
    }

    const tripId = context.params?.id;
    if (!tripId || !TRIP_ID_RE.test(tripId)) {
      return json(404, { error: "Trip not found" });
    }

    const tripRaw = await tripsStore().get(tripId, { type: "json" });
    if (tripRaw === null) {
      return json(404, { error: "Trip not found" });
    }
    const pinHash = pinHashFromRecord(tripRaw);
    const locked = Boolean(pinHash);
    const pathname = new URL(req.url).pathname;
    const signPath = pathname.endsWith("/sign");

    if (signPath) {
      if (req.method !== "POST") {
        return json(405, { error: "Method not allowed" });
      }
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const config = requireCloudinary();
      const photoId = newTripId();
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await signUploadRequest({
        tripId,
        photoId,
        timestamp,
        apiSecret: config.apiSecret,
      });
      return json(200, {
        photoId,
        timestamp,
        signature,
        apiKey: config.apiKey,
        cloudName: config.cloudName,
        folder: cloudinaryFolder(tripId),
        publicId: photoId,
        type: CLOUDINARY_ASSET_TYPE,
        uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
        maxFileSize: MAX_ORIGINAL_BYTES,
        allowedFormats: ORIGINAL_ALLOWED_FORMATS,
      });
    }

    if (req.method === "GET") {
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const store = photosStore();
      const { blobs } = await store.list({ prefix: `${tripId}/` });
      const valid = blobs.filter((blob) => {
        const parts = blob.key.split("/");
        return parts.length === 2 && PHOTO_ID_RE.test(parts[1] ?? "");
      });
      const photos = await Promise.all(
        valid.map(async (blob) => {
          const photoId = blob.key.split("/")[1] ?? "";
          const meta = await store.getMetadata(blob.key);
          const createdAt =
            typeof meta?.metadata?.uploadedAt === "string"
              ? meta.metadata.uploadedAt
              : new Date(0).toISOString();
          const urls = await photoUrls(tripId, photoId, locked);
          const originalUrl = await originalUrlFromMeta(meta?.metadata);
          return { id: photoId, createdAt, originalUrl, ...urls };
        }),
      );
      photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(200, { photos });
    }

    if (req.method === "POST") {
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const { blobs } = await photosStore().list({ prefix: `${tripId}/` });
      const count = blobs.filter((blob) => {
        const parts = blob.key.split("/");
        return parts.length === 2 && PHOTO_ID_RE.test(parts[1] ?? "");
      }).length;
      if (count >= MAX_PHOTOS_PER_TRIP) {
        throw new ValidationError(`A trip can hold at most ${MAX_PHOTOS_PER_TRIP} photos`);
      }

      const form = await req.formData();
      const file = form.get("photo");
      if (!(file instanceof File)) {
        throw new ValidationError("Choose a photo to upload");
      }
      if (file.size > MAX_PHOTO_BYTES) {
        throw new ValidationError("Photo is too large");
      }
      const type = file.type.toLowerCase();
      if (type !== "image/jpeg" && type !== "image/jpg") {
        throw new ValidationError("Photos must be JPEG");
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      if (!isJpeg(buffer)) {
        throw new ValidationError("Photos must be JPEG");
      }

      const requestedId = formString(form, "photo_id");
      const photoId = requestedId ?? newTripId();
      if (!PHOTO_ID_RE.test(photoId)) {
        throw new ValidationError("Invalid photo id");
      }
      const existing = await photosStore().getMetadata(`${tripId}/${photoId}`);
      if (existing) {
        throw new ValidationError("Photo already exists");
      }

      const cloudinaryId = formString(form, "cloudinary_id");
      if (cloudinaryId && !isValidCloudinaryId(tripId, photoId, cloudinaryId)) {
        throw new ValidationError("Original does not match this photo");
      }

      const uploadedAt = new Date().toISOString();
      await photosStore().set(`${tripId}/${photoId}`, buffer.slice().buffer, {
        metadata: {
          contentType: "image/jpeg",
          uploadedAt,
          tripId,
          ...(cloudinaryId ? { cloudinaryId } : {}),
        },
      });
      const urls = await photoUrls(tripId, photoId, locked);
      const originalUrl = cloudinaryId ? await signedOriginalUrl(cloudinaryId) : null;
      return json(201, {
        photo: { id: photoId, createdAt: uploadedAt, originalUrl, ...urls },
      });
    }

    if (req.method === "DELETE") {
      const photoId = context.params?.photoId;
      if (!photoId || !PHOTO_ID_RE.test(photoId)) {
        return json(404, { error: "Photo not found" });
      }
      // If trip has a PIN configured, require an active photo session token.
      // Unlocked/legacy trips without pin_hash intentionally allow unauthenticated deletes, matching GET and POST.
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const store = photosStore();
      const meta = await store.getMetadata(`${tripId}/${photoId}`);
      if (!meta) {
        return json(404, { error: "Photo not found" });
      }
      const cloudinaryId = meta.metadata?.cloudinaryId;
      if (typeof cloudinaryId === "string" && cloudinaryId) {
        try {
          await destroyCloudinaryAsset(cloudinaryId);
        } catch {
          /* gallery delete still succeeds; original may be cleaned up later */
        }
      }
      await store.delete(`${tripId}/${photoId}`);
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: ["/api/trips/:id/photos", "/api/trips/:id/photos/sign", "/api/trips/:id/photos/:photoId"],
};
