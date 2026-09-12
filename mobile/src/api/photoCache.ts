import { Directory, File, Paths } from "expo-file-system";
import { getStore } from "./storage";
import type { PhotoRecord } from "../domain/photos";

const INDEX_KEY = "fairshare.photo.cache.index";
const LIST_KEY_PREFIX = "fairshare.photo.list.";
const PHOTOS_DIR = "fairshare-photos";

type CacheIndex = Record<string, string>;

function photosDirectory(): Directory {
  const dir = new Directory(Paths.cache, PHOTOS_DIR);
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    /* directory may already exist */
  }
  return dir;
}

async function loadIndex(): Promise<CacheIndex> {
  try {
    const raw = await getStore().getItem(INDEX_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as CacheIndex;
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function saveIndex(index: CacheIndex): Promise<void> {
  try {
    await getStore().setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

export async function cachedPhotoUri(tripId: string, photoId: string): Promise<string | null> {
  try {
    const index = await loadIndex();
    const name = index[`${tripId}/${photoId}`];
    if (!name) {
      return null;
    }
    const file = new File(photosDirectory(), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Downloads the display copy so it is viewable offline. Returns the local uri. */
export async function cachePhoto(tripId: string, photo: PhotoRecord): Promise<string | null> {
  try {
    const name = `${photo.id}.jpg`;
    const file = new File(photosDirectory(), name);
    if (file.exists) {
      return file.uri;
    }
    const target = photo.thumbUrl || photo.displayUrl;
    await File.downloadFileAsync(target, file);
    const index = await loadIndex();
    index[`${tripId}/${photo.id}`] = name;
    await saveIndex(index);
    return file.uri;
  } catch {
    return null;
  }
}

export async function removeCachedPhoto(tripId: string, photoId: string): Promise<void> {
  try {
    const index = await loadIndex();
    const key = `${tripId}/${photoId}`;
    const name = index[key];
    if (name) {
      const file = new File(photosDirectory(), name);
      if (file.exists) {
        file.delete();
      }
    }
    delete index[key];
    await saveIndex(index);
  } catch {
    /* ignore */
  }
}

export async function savePhotoList(tripId: string, photos: PhotoRecord[]): Promise<void> {
  try {
    await getStore().setItem(LIST_KEY_PREFIX + tripId, JSON.stringify(photos));
  } catch {
    /* ignore */
  }
}

export async function loadPhotoList(tripId: string): Promise<PhotoRecord[] | null> {
  try {
    const raw = await getStore().getItem(LIST_KEY_PREFIX + tripId);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PhotoRecord[]) : null;
  } catch {
    return null;
  }
}
