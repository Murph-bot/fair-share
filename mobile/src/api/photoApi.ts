import type { PhotoRecord } from "../domain/photos";

import { apiBaseUrl, apiUrl, readError } from "./client";
import { loadPhotoToken, savePhotoToken } from "./photoSession";

export type PhotoPart = Blob | { uri: string; name: string; type: string };

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
  extras?: { photoId?: string; original?: PhotoPart },
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
  if (extras?.original) {
    data.append("original", extras.original as unknown as Blob);
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

// Cloudinary signed original uploads were removed in the Cloudflare migration.
// Originals now upload through the same Worker endpoint as display copies.
