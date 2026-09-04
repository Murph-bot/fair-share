export type PhotoAccess = "locked" | "unlocked";

export function photoAccessState(
  photosLocked: boolean | undefined,
  hasToken: boolean,
): PhotoAccess {
  if (photosLocked === true && !hasToken) {
    return "locked";
  }
  return "unlocked";
}

export function shouldOfferLockCta(photosLocked: boolean | undefined): boolean {
  return photosLocked === false;
}
