import { TRIP_ID_RE } from "@fairshare/domain";
import { initTheme } from "./theme";
import { initLanguage } from "./i18n";
import { captureInstallPrompt } from "./install";
import { renderHome } from "./screens/home";
import { renderTrip } from "./screens/trip";

initTheme();
initLanguage();

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing #app");
}
const root: HTMLElement = app;

function route(): void {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const match = /^\/t\/([a-f0-9]{32})$/.exec(path);
  if (path === "/") {
    renderHome(root);
    return;
  }
  if (match && TRIP_ID_RE.test(match[1])) {
    void renderTrip(root, match[1]);
    return;
  }
  root.innerHTML = `
    <main class="page">
      <h1>Not found</h1>
      <p><a href="/">Back to home</a></p>
    </main>
  `;
}

window.addEventListener("popstate", route);
window.addEventListener("fairshare:route", route);
window.addEventListener("beforeinstallprompt", (event) => {
  captureInstallPrompt(event);
});
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const link = target.closest("a");
  if (
    !link ||
    link.target === "_blank" ||
    link.hasAttribute("download") ||
    link.origin !== window.location.origin
  ) {
    return;
  }
  const url = new URL(link.href);
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  event.preventDefault();
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  route();
});

route();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js");
}
