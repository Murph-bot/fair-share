import { createRemoteTrip, saveTrip } from "../api";
import { parseTrip, TRIP_ID_RE } from "@fairshare/domain";
import { announce } from "../announce";
import { escapeHtml } from "../escape";
import { savePhotoPin, savePhotoToken } from "../photo-session";
import { loadRecents } from "../recents";
import { getTheme, themeButtonHtml, toggleTheme } from "../theme";

function extractTripId(raw: string): string | null {
  const input = raw.trim();
  if (!input) {
    return null;
  }

  const lower = input.toLowerCase();
  if (TRIP_ID_RE.test(lower)) {
    return lower;
  }

  try {
    const url = new URL(input);
    const match = /^\/t\/([a-f0-9]{32})$/i.exec(url.pathname);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch {
    // Not a URL.
  }

  return null;
}

export function renderHome(root: HTMLElement): void {
  const recents = loadRecents();
  const recentList =
    recents.length === 0
      ? `<p class="muted">No trips on this device yet.</p>`
      : `<ul class="recents">${recents
          .map(
            (item) =>
              `<li><a href="/t/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a></li>`,
          )
          .join("")}</ul>`;

  const themeLabel = getTheme() === "dark" ? "Light" : "Dark";

  root.innerHTML = `
    <main class="page home">
      <div class="home-header">
        <p class="kicker">Fair Share</p>
        ${themeButtonHtml(themeLabel)}
      </div>
      <h1>Split trip expenses fairly</h1>
      <p class="lede">Create a trip, add people, and share the link. No accounts, no ads.</p>

      <form id="create-form" class="stack">
        <label for="trip-name">Trip name</label>
        <input id="trip-name" name="name" type="text" required maxlength="80" autocomplete="off" placeholder="Athens weekend">
        <p id="create-error" class="err" hidden></p>
        <button type="submit" class="primary">Create trip</button>
      </form>

      <section class="block">
        <h2>Open an existing trip</h2>
        <form id="open-form" class="row">
          <label class="sr" for="trip-link">Trip link or ID</label>
          <input id="trip-link" name="link" type="text" inputmode="url" autocomplete="off" placeholder="https://fair-share-trips.netlify.app/t/…">
          <button type="submit" class="secondary">Open trip</button>
        </form>
        <p id="open-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>Open JSON</h2>
        <p class="muted">Money only. Photos stay on the hosted trip and are not in the file.</p>
        <input id="import-json" class="sr" type="file" accept="application/json,.json">
        <button type="button" id="import-json-btn" class="secondary">Choose JSON file</button>
        <p id="import-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>On this device</h2>
        ${recentList}
      </section>
    </main>
  `;

  const form = root.querySelector("#create-form") as HTMLFormElement;
  const errorEl = root.querySelector("#create-error") as HTMLElement;
  const openForm = root.querySelector("#open-form") as HTMLFormElement;
  const openInput = openForm.elements.namedItem("link") as HTMLInputElement;
  const openError = root.querySelector("#open-error") as HTMLElement;
  const importInput = root.querySelector("#import-json") as HTMLInputElement;
  const importBtn = root.querySelector("#import-json-btn") as HTMLButtonElement;
  const importError = root.querySelector("#import-error") as HTMLElement;
  const createBtn = form.querySelector("button") as HTMLButtonElement;

  const busyButtons = [createBtn, openForm.querySelector("button") as HTMLButtonElement, importBtn];

  const setBusy = (busy: boolean): void => {
    busyButtons.forEach((button) => {
      button.disabled = busy;
    });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const input = form.elements.namedItem("name") as HTMLInputElement;
    setBusy(true);
    try {
      const { id, pin, photos_token } = await createRemoteTrip(input.value);
      savePhotoPin(id, pin);
      savePhotoToken(id, photos_token);
      announce(`Trip created. PIN: ${pin}`);
      history.pushState({}, "", `/t/${id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : "Could not create trip";
      setBusy(false);
    }
  });

  openForm.addEventListener("submit", (event) => {
    event.preventDefault();
    openError.hidden = true;
    const id = extractTripId(openInput.value);
    if (!id) {
      openError.hidden = false;
      openError.textContent = "Paste a Fair Share link or the 32-character trip ID";
      return;
    }
    history.pushState({}, "", `/t/${id}`);
    window.dispatchEvent(new Event("fairshare:route"));
  });

  importBtn.addEventListener("click", () => {
    importInput.click();
  });

  const themeToggle = root.querySelector("#theme-toggle") as HTMLButtonElement | null;
  themeToggle?.addEventListener("click", () => {
    const next = toggleTheme();
    themeToggle.textContent = next === "dark" ? "Light" : "Dark";
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) {
      return;
    }
    importError.hidden = true;
    setBusy(true);
    try {
      const raw: unknown = JSON.parse(await file.text());
      const trip = parseTrip(raw);
      const created = await createRemoteTrip(trip.name);
      await saveTrip(created.id, trip);
      savePhotoPin(created.id, created.pin);
      savePhotoToken(created.id, created.photos_token);
      announce(`Trip imported: ${created.id}`);
      history.pushState({}, "", `/t/${created.id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      importError.hidden = false;
      importError.textContent = err instanceof Error ? err.message : "Could not import that trip";
      setBusy(false);
    }
  });
}
