import {
  createRemoteDemoTrip,
  createRemoteTemplateTrip,
  createRemoteTrip,
  fetchTrip,
  saveTrip,
  type PublicTrip,
} from "../api";
import { getInstallPrompt, isStandalone, runInstallPrompt } from "../install";
import { backupJson, parseBackup, parseTrip, t, TRIP_ID_RE, TRIP_TEMPLATES } from "@fairshare/domain";
import { announce } from "../announce";
import { escapeHtml } from "../escape";
import { savePhotoPin, savePhotoToken } from "../photo-session";
import { loadRecents, rememberRecent } from "../recents";
import { getTheme, languageButtonHtml, nextLanguage, themeButtonHtml, toggleTheme } from "../theme";

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
      ? `<p class="muted">${t("No recent trips.")}</p>`
      : `<ul class="recents">${recents
          .map(
            (item) =>
              `<li><a href="/t/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a></li>`,
          )
          .join("")}</ul>`;

  const showInstall = getInstallPrompt() !== null && !isStandalone();
  const installBlock = showInstall
    ? `<section class="block">
        <h2>${t("Install app")}</h2>
        <p class="muted">${t("Add Fair Share to your home screen for quick access.")}</p>
        <button type="button" id="install-btn" class="secondary">${t("Install")}</button>
      </section>`
    : "";

  const themeLabel = getTheme() === "dark" ? "Light" : "Dark";

  root.innerHTML = `
    <main class="page home">
      <div class="home-header">
        <p class="kicker"><img src="/icon.svg" alt="" class="brand-mark">${t("Fair Share")}</p>
        <div class="home-toggles">
          ${languageButtonHtml()}
          ${themeButtonHtml(themeLabel)}
        </div>
      </div>
      <h1>${t("Split trip expenses fairly")}</h1>
      <p class="lede">${t("Create a trip, add people, and share the link. No accounts, no ads.")}</p>

      <form id="create-form" class="stack">
        <label for="trip-name">${t("Trip name")}</label>
        <input id="trip-name" name="name" type="text" required maxlength="80" autocomplete="off" placeholder="${t("Athens weekend")}">
        <p id="create-error" class="err" hidden></p>
        <button type="submit" class="primary">${t("Create trip")}</button>
      </form>

      <section class="block">
        <h2>${t("Try a demo")}</h2>
        <p class="muted">${t("Play with an example trip before creating your own.")}</p>
        <button type="button" id="demo-trip-btn" class="secondary">${t("Try a demo")}</button>
        <p id="demo-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>${t("Start from a template")}</h2>
        <p class="muted">${t("Create a trip with people already added.")}</p>
        <div class="row">
          ${TRIP_TEMPLATES.map(
            (template) =>
              `<button type="button" class="secondary" data-template="${escapeHtml(template.id)}">${t(template.name)}</button>`,
          ).join("")}
        </div>
        <p id="template-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>${t("Open an existing trip")}</h2>
        <form id="open-form" class="row">
          <label class="sr" for="trip-link">${t("Trip link or ID")}</label>
          <input id="trip-link" name="link" type="text" inputmode="url" autocomplete="off" placeholder="https://fair-share-trips.pages.dev/t/…">
          <button type="submit" class="secondary">${t("Open trip")}</button>
        </form>
        <p id="open-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>${t("Open JSON")}</h2>
        <p class="muted">${t("Money only. Photos stay on the hosted trip and are not in the file.")}</p>
        <input id="import-json" class="sr" type="file" accept="application/json,.json">
        <button type="button" id="import-json-btn" class="secondary">${t("Choose JSON file")}</button>
        <p id="import-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>${t("Backup")}</h2>
        <p class="muted">${t("Download all trips on this device as one backup file, or restore a backup.")}</p>
        <div class="row">
          <button type="button" id="backup-export" class="secondary">${t("Export backup")}</button>
          <button type="button" id="backup-import-btn" class="secondary">${t("Restore backup")}</button>
          <input id="backup-import" class="sr" type="file" accept="application/json,.json">
        </div>
        <p id="backup-error" class="err" hidden></p>
      </section>

      <section class="block">
        <h2>${t("On this device")}</h2>
        ${recentList}
      </section>

      ${installBlock}

      <p class="muted footer-note">${t("No accounts, no ads, no tracking. Your data lives on the trip link, and backups stay on this device.")}</p>
    </main>
  `;

  const form = root.querySelector("#create-form") as HTMLFormElement;
  const errorEl = root.querySelector("#create-error") as HTMLElement;
  const demoBtn = root.querySelector("#demo-trip-btn") as HTMLButtonElement;
  const demoError = root.querySelector("#demo-error") as HTMLElement;
  const templateError = root.querySelector("#template-error") as HTMLElement | null;
  const templateBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-template]"));
  const openForm = root.querySelector("#open-form") as HTMLFormElement;
  const openInput = openForm.elements.namedItem("link") as HTMLInputElement;
  const openError = root.querySelector("#open-error") as HTMLElement;
  const importInput = root.querySelector("#import-json") as HTMLInputElement;
  const importBtn = root.querySelector("#import-json-btn") as HTMLButtonElement;
  const importError = root.querySelector("#import-error") as HTMLElement;
  const backupExportBtn = root.querySelector("#backup-export") as HTMLButtonElement | null;
  const backupImportInput = root.querySelector("#backup-import") as HTMLInputElement | null;
  const backupImportBtn = root.querySelector("#backup-import-btn") as HTMLButtonElement | null;
  const backupError = root.querySelector("#backup-error") as HTMLElement | null;
  const createBtn = form.querySelector("button") as HTMLButtonElement;

  const installBtn = root.querySelector("#install-btn") as HTMLButtonElement | null;
  const busyButtons = [
    createBtn,
    demoBtn,
    ...templateBtns,
    openForm.querySelector("button") as HTMLButtonElement,
    importBtn,
    installBtn,
    backupExportBtn,
    backupImportBtn,
  ].filter((button): button is HTMLButtonElement => button !== null);

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
      announce(t("Trip created. PIN: {{pin}}", { pin }));
      history.pushState({}, "", `/t/${id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : t("Could not create trip");
      setBusy(false);
    }
  });

  demoBtn?.addEventListener("click", async () => {
    demoError.hidden = true;
    setBusy(true);
    try {
      const { id, pin, photos_token } = await createRemoteDemoTrip(t("Demo trip"));
      savePhotoPin(id, pin);
      savePhotoToken(id, photos_token);
      announce(t("Trip created. PIN: {{pin}}", { pin }));
      history.pushState({}, "", `/t/${id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      demoError.hidden = false;
      demoError.textContent = err instanceof Error ? err.message : t("Could not create trip");
      setBusy(false);
    }
  });

  templateBtns.forEach((button) => {
    button.addEventListener("click", async () => {
      const templateId = button.dataset.template ?? "";
      if (templateError) {
        templateError.hidden = true;
      }
      setBusy(true);
      try {
        const { id, pin, photos_token } = await createRemoteTemplateTrip(templateId);
        savePhotoPin(id, pin);
        savePhotoToken(id, photos_token);
        announce(t("Trip created. PIN: {{pin}}", { pin }));
        history.pushState({}, "", `/t/${id}`);
        window.dispatchEvent(new Event("fairshare:route"));
      } catch (err) {
        if (templateError) {
          templateError.hidden = false;
          templateError.textContent = err instanceof Error ? err.message : t("Could not create trip");
        }
        setBusy(false);
      }
    });
  });

  openForm.addEventListener("submit", (event) => {
    event.preventDefault();
    openError.hidden = true;
    const id = extractTripId(openInput.value);
    if (!id) {
      openError.hidden = false;
      openError.textContent = t("Paste a Fair Share link or the 32-character trip ID");
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
    themeToggle.textContent = next === "dark" ? t("Light") : t("Dark");
  });

  const languageToggle = root.querySelector("#language-toggle") as HTMLButtonElement | null;
  languageToggle?.addEventListener("click", () => {
    nextLanguage();
    window.location.reload();
  });

  installBtn?.addEventListener("click", async () => {
    setBusy(true);
    try {
      const result = await runInstallPrompt();
      if (result?.outcome === "accepted") {
        installBtn.remove();
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
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
      importError.textContent = err instanceof Error ? err.message : t("Could not import that trip");
      setBusy(false);
    }
  });

  backupExportBtn?.addEventListener("click", async () => {
    if (backupError) {
      backupError.hidden = true;
    }
    setBusy(true);
    try {
      const settled = await Promise.allSettled(loadRecents().map((recent) => fetchTrip(recent.id)));
      const trips = settled
        .filter((result): result is PromiseFulfilledResult<PublicTrip> => result.status === "fulfilled")
        .map((result) => result.value);
      if (trips.length === 0) {
        throw new Error(t("No trips on this device to back up"));
      }
      const blob = new Blob([backupJson(trips)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "fair-share-backup.json";
      link.click();
      URL.revokeObjectURL(href);
      announce(t("Backup downloaded"));
    } catch (err) {
      if (backupError) {
        backupError.hidden = false;
        backupError.textContent = err instanceof Error ? err.message : t("Could not export backup");
      }
      setBusy(false);
    }
  });

  backupImportBtn?.addEventListener("click", () => {
    backupImportInput?.click();
  });

  backupImportInput?.addEventListener("change", async () => {
    const file = backupImportInput.files?.[0];
    backupImportInput.value = "";
    if (!file) {
      return;
    }
    if (backupError) {
      backupError.hidden = true;
    }
    setBusy(true);
    try {
      const raw: unknown = JSON.parse(await file.text());
      const trips = parseBackup(raw);
      const created: Awaited<ReturnType<typeof createRemoteTrip>>[] = [];
      for (const trip of trips) {
        const remote = await createRemoteTrip(trip.name);
        await saveTrip(remote.id, trip);
        savePhotoPin(remote.id, remote.pin);
        savePhotoToken(remote.id, remote.photos_token);
        rememberRecent(remote.id, trip.name);
        created.push(remote);
      }
      const first = created[0];
      if (!first) {
        throw new Error(t("No trips found in this backup"));
      }
      savePhotoPin(first.id, first.pin);
      savePhotoToken(first.id, first.photos_token);
      announce(t("Backup restored"));
      history.pushState({}, "", `/t/${first.id}`);
      window.dispatchEvent(new Event("fairshare:route"));
    } catch (err) {
      if (backupError) {
        backupError.hidden = false;
        backupError.textContent = err instanceof Error ? err.message : t("Could not restore backup");
      }
      setBusy(false);
    }
  });
}
