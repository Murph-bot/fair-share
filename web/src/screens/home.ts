import { createRemoteTrip, saveTrip } from "../api";
import { parseTrip } from "@fairshare/domain";
import { escapeHtml } from "../escape";
import { savePhotoPin, savePhotoToken } from "../photo-session";
import { loadRecents } from "../recents";

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

  root.innerHTML = `
    <main class="page home">
      <p class="kicker">Fair share</p>
      <h1>Split a trip</h1>
      <p class="lede">Create a trip, add people and expenses, then send the link. Anyone with it can edit.</p>
      <form id="create-form" class="stack">
        <label for="trip-name">Trip name</label>
        <input id="trip-name" name="name" type="text" required maxlength="80" autocomplete="off" placeholder="Athens weekend">
        <p id="create-error" class="err" hidden></p>
        <button type="submit">Create trip</button>
      </form>
      <section class="block">
        <h2>Open JSON</h2>
        <p class="muted">Money only. Photos stay on the hosted trip and are not in the file.</p>
        <input id="import-json" class="sr" type="file" accept="application/json,.json">
        <button type="button" id="import-json-btn">Open JSON</button>
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
  const importInput = root.querySelector("#import-json") as HTMLInputElement;
  const importBtn = root.querySelector("#import-json-btn") as HTMLButtonElement;
  const importError = root.querySelector("#import-error") as HTMLElement;
  const createBtn = form.querySelector("button") as HTMLButtonElement;

  const setImportBusy = (busy: boolean): void => {
    importBtn.disabled = busy;
    createBtn.disabled = busy;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    const input = form.elements.namedItem("name") as HTMLInputElement;
    setImportBusy(true);
    try {
      const { id, pin, photos_token } = await createRemoteTrip(input.value);
      savePhotoPin(id, pin);
      savePhotoToken(id, photos_token);
      history.pushState({}, "", `/t/${id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : "Could not create trip";
      setImportBusy(false);
    }
  });

  importBtn.addEventListener("click", () => {
    importInput.click();
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) {
      return;
    }
    importError.hidden = true;
    setImportBusy(true);
    try {
      const raw: unknown = JSON.parse(await file.text());
      const trip = parseTrip(raw);
      const created = await createRemoteTrip(trip.name);
      await saveTrip(created.id, trip);
      savePhotoPin(created.id, created.pin);
      savePhotoToken(created.id, created.photos_token);
      history.pushState({}, "", `/t/${created.id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      importError.hidden = false;
      importError.textContent = err instanceof Error ? err.message : "Could not import that trip";
      setImportBusy(false);
    }
  });
}
