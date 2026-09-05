function ensureStatusRegion(): HTMLElement {
  let el = document.getElementById("fairshare-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "fairshare-status";
    el.className = "sr";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.appendChild(el);
  }
  return el;
}

export function announce(message: string): void {
  const el = ensureStatusRegion();
  el.textContent = message;
  window.setTimeout(() => {
    if (el.textContent === message) {
      el.textContent = "";
    }
  }, 1000);
}
