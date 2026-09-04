import type { PhotoRecord } from "../domain/photos";

import { apiBaseUrl, apiUrl, readError } from "./client";
import { loadPhotoToken, savePhotoToken } from "./photoSession";

export type PhotoPart = Blob | { uri: string; name: string; type: string };

export type OriginalUploadSign = {
  photoId: string;
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  type: string;
  uploadUrl: string;
  maxFileSize: number;
  allowedFormats: string;
};

export function absolutePhotoUrl(url: string): string {
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${apiBaseUrl()}${url}`;
  }
  return url;
}

function toAbsolutePhoto(photo: PhotoRecord): PhotoRecord {
  return {
    ...photo,
    displayUrl: absolutePhotoUrl(photo.displayUrl),
    thumbUrl: absolutePhotoUrl(photo.thumbUrl),
    originalUrl: photo.originalUrl ? absolutePhotoUrl(photo.originalUrl) : null,
  };
}

async function tripAuthHeaders(tripId: string): Promise<Record<string, string>> {
  const token = await loadPhotoToken(tripId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function unlockPhotos(tripId: string, pin: string): Promise<string> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}/session`), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pin }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    throw new Error("Could not unlock photos");
  }
  await savePhotoToken(tripId, body.token);
  return body.token;
}

export async function fetchPhotos(tripId: string): Promise<PhotoRecord[]> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}/photos`), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(await tripAuthHeaders(tripId)),
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { photos?: PhotoRecord[] };
  return Array.isArray(body.photos) ? body.photos.map(toAbsolutePhoto) : [];
}

export async function uploadPhoto(
  tripId: string,
  photo: PhotoPart,
  extras?: { photoId?: string; cloudinaryId?: string },
): Promise<PhotoRecord> {
  const data = new FormData();
  if (photo instanceof Blob) {
    data.append("photo", photo, "photo.jpg");
  } else {
    data.append("photo", photo as unknown as Blob);
  }
  if (extras?.photoId) {
    data.append("photo_id", extras.photoId);
  }
  if (extras?.cloudinaryId) {
    data.append("cloudinary_id", extras.cloudinaryId);
  }
  const response = await fetch(apiUrl(`/api/trips/${tripId}/photos`), {
    method: "POST",
    headers: await tripAuthHeaders(tripId),
    body: data,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { photo?: PhotoRecord };
  if (!body.photo) {
    throw new Error("Could not upload photo");
  }
  return toAbsolutePhoto(body.photo);
}

export async function deletePhoto(tripId: string, photoId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}/photos/${photoId}`), {
    method: "DELETE",
    headers: await tripAuthHeaders(tripId),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
}

export async function lockTripPhotos(
  tripId: string,
  pin?: string,
): Promise<{ pin: string; photos_token: string }> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}/pin`), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pin ? { pin } : {}),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { pin?: unknown; photos_token?: unknown };
  if (typeof body.pin !== "string" || typeof body.photos_token !== "string") {
    throw new Error("Could not set photos PIN");
  }
  await savePhotoToken(tripId, body.photos_token);
  return { pin: body.pin, photos_token: body.photos_token };
}

export async function signOriginalUpload(tripId: string): Promise<OriginalUploadSign> {
  const response = await fetch(apiUrl(`/api/trips/${tripId}/photos/sign`), {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(await tripAuthHeaders(tripId)),
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as Partial<OriginalUploadSign>;
  if (
    typeof body.photoId !== "string" ||
    typeof body.timestamp !== "number" ||
    typeof body.signature !== "string" ||
    typeof body.apiKey !== "string" ||
    typeof body.cloudName !== "string" ||
    typeof body.folder !== "string" ||
    typeof body.publicId !== "string" ||
    typeof body.type !== "string" ||
    typeof body.uploadUrl !== "string" ||
    typeof body.maxFileSize !== "number" ||
    typeof body.allowedFormats !== "string"
  ) {
    throw new Error("Could not prepare original upload");
  }
  return body as OriginalUploadSign;
}

export async function uploadOriginalToCloudinary(
  file: PhotoPart,
  sign: OriginalUploadSign,
): Promise<string> {
  if (file instanceof Blob && file.size > sign.maxFileSize) {
    throw new Error("Original is too large");
  }
  const data = new FormData();
  if (file instanceof Blob) {
    data.append("file", file);
  } else {
    data.append("file", file as unknown as Blob);
  }
  data.append("api_key", sign.apiKey);
  data.append("timestamp", String(sign.timestamp));
  data.append("signature", sign.signature);
  data.append("folder", sign.folder);
  data.append("public_id", sign.publicId);
  data.append("type", sign.type);
  data.append("allowed_formats", sign.allowedFormats);
  const response = await fetch(sign.uploadUrl, { method: "POST", body: data });
  if (!response.ok) {
    throw new Error("Could not upload original");
  }
  const body = (await response.json()) as { public_id?: unknown };
  if (typeof body.public_id !== "string" || !body.public_id) {
    throw new Error("Could not upload original");
  }
  return body.public_id;
}
