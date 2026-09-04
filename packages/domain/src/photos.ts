import type { Trip } from "./trip";

export const PHOTO_ID_RE = /^[a-f0-9]{32}$/;
export const MAX_PHOTOS_PER_TRIP = 100;
export const MAX_PHOTO_BYTES = 4_000_000;
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export type PhotoRecord = {
  id: string;
  createdAt: string;
  displayUrl: string;
  thumbUrl: string;
  originalUrl: string | null;
};

export type PublicTrip = Trip & { photos_locked?: boolean };
