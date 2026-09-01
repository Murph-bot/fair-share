import { fetchPhotos, unlockPhotos, uploadPhoto, type PublicTrip } from "../api";
import { compressImage } from "../compress-image";
import type { PhotoRecord } from "../domain/photos";
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
      return `<li>
        <a href="${escapeHtml(displayUrl)}" target="_blank" rel="noopener noreferrer">
          <img src="${escapeHtml(thumbUrl)}" alt="Trip photo" width="400" height="400">
        </a>
      </li>`;
    })
    .join("")}</ul>`;
}

function unlockedHtml(): string {
  return `
    <form id="photo-form" class="stack">
      <label for="photo-file">Add a photo</label>
      <input id="photo-file" name="photo" type="file" accept="image/*">
      <p id="photo-error" class="err" hidden></p>
    </form>
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
    <p id="pin-error" class="err" hidden></p>
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
  body.innerHTML = unlocked ? unlockedHtml() : lockedHtml();

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
      await uploadPhoto(tripId, jpeg);
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
  } catch (err) {
    list.innerHTML = `<p class="err">${escapeHtml(err instanceof Error ? err.message : "Could not load photos")}</p>`;
  }
}
