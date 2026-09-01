import type { Config, Context } from "@netlify/functions";
import { ValidationError } from "../../web/src/domain/errors";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_TRIP,
  PHOTO_ID_RE,
} from "../../web/src/domain/photos";
import { signPhotoAccess, verifySessionToken } from "../../web/src/domain/pin";
import { newTripId, TRIP_ID_RE } from "../../web/src/domain/trip";
import {
  bearerToken,
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

export default async (req: Request, context: Context) => {
  try {
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

    if (req.method === "GET") {
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const { blobs } = await photosStore().list({ prefix: `${tripId}/` });
      const photos = [];
      for (const blob of blobs) {
        const photoId = blob.key.split("/")[1];
        if (!photoId || !PHOTO_ID_RE.test(photoId)) {
          continue;
        }
        const meta = await photosStore().getMetadata(blob.key);
        const createdAt =
          typeof meta?.metadata?.uploadedAt === "string"
            ? meta.metadata.uploadedAt
            : new Date(0).toISOString();
        const urls = await photoUrls(tripId, photoId, locked);
        photos.push({
          id: photoId,
          createdAt,
          originalUrl: null,
          ...urls,
        });
      }
      photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(200, { photos });
    }

    if (req.method === "POST") {
      const denied = await requirePhotoSession(req, tripId, pinHash);
      if (denied) {
        return denied;
      }
      const { blobs } = await photosStore().list({ prefix: `${tripId}/` });
      const count = blobs.filter((blob) => PHOTO_ID_RE.test(blob.key.split("/")[1] ?? "")).length;
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

      const photoId = newTripId();
      const uploadedAt = new Date().toISOString();
      await photosStore().set(`${tripId}/${photoId}`, buffer, {
        metadata: {
          contentType: "image/jpeg",
          uploadedAt,
          tripId,
        },
      });
      const urls = await photoUrls(tripId, photoId, locked);
      return json(201, {
        photo: { id: photoId, createdAt: uploadedAt, originalUrl: null, ...urls },
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = {
  path: "/api/trips/:id/photos",
};
