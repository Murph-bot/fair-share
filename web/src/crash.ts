/**
 * Privacy-friendly crash handling: no analytics, no third-party trackers.
 * Errors are kept on-device in a small ring buffer so the user can report
 * them if they want to. Nothing leaves the browser.
 */
const LOG_KEY = "fairshare.errorlog";
const LIMIT = 20;

type ErrorRecord = {
  at: string;
  message: string;
};

export function initCrashReporting(): void {
  window.addEventListener("error", (event) => {
    recordError(event.message || "Unknown error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordError(reason instanceof Error ? reason.message : String(reason));
  });
}

function recordError(message: string): void {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const list: ErrorRecord[] = raw ? (JSON.parse(raw) as ErrorRecord[]) : [];
    list.push({ at: new Date().toISOString(), message: String(message).slice(0, 500) });
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-LIMIT)));
  } catch {
    /* storage may be unavailable; never crash inside the crash handler */
  }
  console.error(`Fair Share error: ${message}`);
}

export function loadErrorLog(): ErrorRecord[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as ErrorRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearErrorLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}
