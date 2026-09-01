const TOKEN_PREFIX = "fairshare.photos.token.";
const PIN_PREFIX = "fairshare.photos.pin.";

export function loadPhotoToken(tripId: string): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_PREFIX + tripId) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePhotoToken(tripId: string, token: string): void {
  try {
    sessionStorage.setItem(TOKEN_PREFIX + tripId, token);
  } catch {
    /* private mode */
  }
}

export function loadPhotoPin(tripId: string): string | undefined {
  try {
    return sessionStorage.getItem(PIN_PREFIX + tripId) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePhotoPin(tripId: string, pin: string): void {
  try {
    sessionStorage.setItem(PIN_PREFIX + tripId, pin);
  } catch {
    /* private mode */
  }
}
