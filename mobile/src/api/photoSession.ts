import {
  configureStorage,
  getStore,
  memoryTokenStore,
  type TokenStore,
} from "./storage";

export type { TokenStore };
export { memoryTokenStore };

export function configurePhotoSessionStore(store: TokenStore): void {
  configureStorage(store);
}

function tokenKey(tripId: string): string {
  return `fairshare.photos.token.${tripId}`;
}

function pinKey(tripId: string): string {
  return `fairshare.photos.pin.${tripId}`;
}

export async function loadPhotoToken(tripId: string): Promise<string | undefined> {
  try {
    return (await getStore().getItem(tokenKey(tripId))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function savePhotoToken(tripId: string, token: string): Promise<void> {
  try {
    await getStore().setItem(tokenKey(tripId), token);
  } catch {
    /* private mode / SecureStore quota */
  }
}

export async function loadPhotoPin(tripId: string): Promise<string | undefined> {
  try {
    return (await getStore().getItem(pinKey(tripId))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function savePhotoPin(tripId: string, pin: string): Promise<void> {
  try {
    await getStore().setItem(pinKey(tripId), pin);
  } catch {
    /* private mode / SecureStore quota */
  }
}

export async function clearPhotoPin(tripId: string): Promise<void> {
  try {
    await getStore().removeItem(pinKey(tripId));
  } catch {
    /* ignore */
  }
}

export async function clearPhotoToken(tripId: string): Promise<void> {
  try {
    await getStore().removeItem(tokenKey(tripId));
  } catch {
    /* ignore */
  }
}
