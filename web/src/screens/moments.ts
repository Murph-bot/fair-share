import {
  deletePhoto,
  fetchPhotos,
  lockTripPhotos,
  signOriginalUpload,
  unlockPhotos,
  uploadPhoto,
  type PublicTrip,
} from "../api";
import { uploadOriginalToCloudinary } from "../cloudinary-upload";
import { MAX_ORIGINAL_BYTES } from "@fairshare/domain/cloudinary";
import { compressImage } from "../compress-image";
import type { PhotoRecord } from "@fairshare/domain/photos";
import { announce } from "../announce";
import { escapeHtml } from "../escape";
import { loadPhotoToken, savePhotoPin, savePhotoToken } from "../photo-session";

function setLocalError(el: HTMLElement | null, message: string | null): void {
  if (!el) {
    return;
  }
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function safePhotoUrl(url: string): string | undefined {
  if (url.startsWith("/uploads/photos/") || url.startsWith("/.netlify/images?")) {
    return url;
  }
  return undefined;
}

function safeOriginalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return undefined;
    }
    if (parsed.hostname === "api.cloudinary.com" || parsed.hostname.endsWith(".cloudinary.com")) {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function galleryHtml(photos: PhotoRecord[]): string {
  if (photos.length === 0) {
    return `<p class="muted">No photos yet.</p>`;
  }
  return `<ul class="moments-grid">${photos
    .map((photo) => {
      const displayUrl = safePhotoUrl(photo.displayUrl);
      const thumbUrl = safePhotoUrl(photo.thumbUrl) ?? displayUrl;
      if (!displayUrl || !thumbUrl) {
        return "";
      }
      const originalUrl = photo.originalUrl ? safeOriginalUrl(photo.originalUrl) : undefined;
      const original = originalUrl
        ? `<a class="text-btn" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener noreferrer">Original</a>`
        : "";
      return `<li class="moment-tile">
        <a href="${escapeHtml(displayUrl)}" target="_blank" rel="noopener noreferrer">
          <img src="${escapeHtml(thumbUrl)}" alt="Trip photo" width="400" height="400">
        </a>
        <div class="moment-actions">
          ${original}
          <button type="button" class="text-btn photo-delete-btn" data-delete-photo="${escapeHtml(photo.id)}" aria-label="Delete photo">Delete</button>
        </div>
      </li>`;
    })
    .join("")}</ul>`;
}

function unlockedHtml(showLockCta: boolean = false): string {
  const lockCta = showLockCta
    ? `
    <div class="lock-cta stack">
      <p class="muted">Photos on this trip are not locked with a PIN.</p>
      <form id="lock-form" class="row">
        <label class="sr" for="new-pin">Choose 6-digit PIN (optional)</label>
        <input id="new-pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="6-digit PIN (optional)">
        <button type="submit">Lock photos with a PIN</button>
      </form>
      <p id="lock-error" class="err" role="alert" aria-live="assertive" hidden></p>
    </div>
  `
    : "";
  return `
    <form id="photo-form" class="stack">
      <label for="photo-file">Add a photo</label>
      <input id="photo-file" name="photo" type="file" accept="image/*">
      <p id="photo-error" class="err" role="alert" aria-live="assertive" hidden></p>
    </form>
    ${lockCta}
    <div id="photo-list"><p class="muted">Loading photos…</p></div>
  `;
}

function lockedHtml(): string {
  return `
    <p class="muted">Enter the trip PIN to view and add photos. Expenses stay open without it.</p>
    <form id="pin-form" class="row">
      <label class="sr" for="photo-pin">Photos PIN</label>
      <input id="photo-pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="6-digit PIN" required>
      <button type="submit">Unlock</button>
    </form>
    <p id="pin-error" class="err" role="alert" aria-live="assertive" hidden></p>
  `;
}

export function momentsSection(): string {
  return `
    <section class="block" id="moments">
      <h2>Moments</h2>
      <div id="moments-body"></div>
    </section>
  `;
}

export function bindMoments(root: HTMLElement, tripId: string, trip: PublicTrip): void {
  const body = root.querySelector("#moments-body") as HTMLElement | null;
  if (!body) {
    return;
  }

  const locked = Boolean(trip.photos_locked);
  const unlocked = !locked || Boolean(loadPhotoToken(tripId));
  body.innerHTML = unlocked ? unlockedHtml(!locked) : lockedHtml();

  const lockForm = body.querySelector("#lock-form") as HTMLFormElement | null;
  const lockError = body.querySelector("#lock-error") as HTMLElement | null;
  lockForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = lockForm.elements.namedItem("pin") as HTMLInputElement;
    const submitBtn = lockForm.querySelector("button[type='submit']") as HTMLButtonElement | null;
    const pinVal = input.value.trim();
    if (pinVal && !/^\d{6}$/.test(pinVal)) {
      setLocalError(lockError, "PIN must be 6 digits");
      return;
    }
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Locking…";
      }
      setLocalError(lockError, null);
      const res = await lockTripPhotos(tripId, pinVal || undefined);
      savePhotoToken(tripId, res.photos_token);
      savePhotoPin(tripId, res.pin);
      const copyPin = root.querySelector("#copy-pin") as HTMLButtonElement | null;
      if (copyPin) {
        copyPin.hidden = false;
        copyPin.textContent = "Copy PIN";
      }
      try {
        await navigator.clipboard.writeText(res.pin);
        if (copyPin) {
          copyPin.textContent = "PIN copied";
          window.setTimeout(() => {
            copyPin.textContent = "Copy PIN";
          }, 2000);
        }
        announce("Photos locked. PIN copied.");
      } catch {
        announce(`Photos locked. PIN: ${res.pin}`);
      }
      bindMoments(root, tripId, { ...trip, photos_locked: true });
    } catch (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Lock photos with a PIN";
      }
      setLocalError(lockError, err instanceof Error ? err.message : "Could not lock photos");
    }
  });

  const pinForm = body.querySelector("#pin-form") as HTMLFormElement | null;
  pinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = pinForm.elements.namedItem("pin") as HTMLInputElement;
    const errorEl = body.querySelector("#pin-error") as HTMLElement;
    try {
      const token = await unlockPhotos(tripId, input.value);
      savePhotoToken(tripId, token);
      savePhotoPin(tripId, input.value.trim());
      const copyPin = root.querySelector("#copy-pin") as HTMLButtonElement | null;
      if (copyPin) {
        copyPin.hidden = false;
      }
      bindMoments(root, tripId, trip);
    } catch (err) {
      setLocalError(errorEl, err instanceof Error ? err.message : "Could not unlock photos");
    }
  });

  const fileInput = body.querySelector("#photo-file") as HTMLInputElement | null;
  const photoError = body.querySelector("#photo-error") as HTMLElement | null;
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    try {
      setLocalError(photoError, null);
      fileInput.disabled = true;
      const jpeg = await compressImage(file);
      let extras: { photoId?: string; cloudinaryId?: string } | undefined;
      if (file.size > jpeg.size && file.size <= MAX_ORIGINAL_BYTES) {
        try {
          const sign = await signOriginalUpload(tripId);
          const cloudinaryId = await uploadOriginalToCloudinary(file, sign);
          extras = { photoId: sign.photoId, cloudinaryId };
        } catch {
          extras = undefined;
        }
      }
      await uploadPhoto(tripId, jpeg, extras);
      await fillList(body, tripId);
    } catch (err) {
      setLocalError(photoError, err instanceof Error ? err.message : "Could not upload photo");
    } finally {
      fileInput.disabled = false;
    }
  });

  if (unlocked) {
    void fillList(body, tripId);
  }
}

async function fillList(body: HTMLElement, tripId: string): Promise<void> {
  const list = body.querySelector("#photo-list");
  if (!list) {
    return;
  }
  const photoError = body.querySelector("#photo-error") as HTMLElement | null;
  try {
    const photos = await fetchPhotos(tripId);
    list.innerHTML = galleryHtml(photos);
    list.querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => {
        const link = img.closest("a");
        if (link && img.src !== link.href) {
          img.src = link.href;
        }
      });
    });
    list.querySelectorAll<HTMLButtonElement>("[data-delete-photo]").forEach((button) => {
      button.addEventListener("click", async () => {
        const photoId = button.dataset.deletePhoto;
        if (!photoId) return;
        if (!window.confirm("Delete this photo permanently?")) {
          return;
        }
        try {
          list.querySelectorAll<HTMLButtonElement>("[data-delete-photo]").forEach((b) => {
            b.disabled = true;
          });
          button.textContent = "Deleting…";
          setLocalError(photoError, null);
          await deletePhoto(tripId, photoId);
          announce("Photo deleted");
          await fillList(body, tripId);
        } catch (err) {
          list.querySelectorAll<HTMLButtonElement>("[data-delete-photo]").forEach((b) => {
            b.disabled = false;
          });
          button.textContent = "Delete";
          setLocalError(photoError, err instanceof Error ? err.message : "Could not delete photo");
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="err">${escapeHtml(err instanceof Error ? err.message : "Could not load photos")}</p>`;
  }
}
