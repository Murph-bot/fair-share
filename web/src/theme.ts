const THEME_KEY = "fairshare-theme";

type Theme = "light" | "dark";

export function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  let theme: Theme = "light";
  if (stored === "light" || stored === "dark") {
    theme = stored;
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    theme = "dark";
  }
  applyTheme(theme);
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

export function themeButtonHtml(label?: string): string {
  const text = label ?? "Mode";
  return `<button type="button" id="theme-toggle" class="text-btn" aria-label="Toggle dark mode">${text}</button>`;
}
