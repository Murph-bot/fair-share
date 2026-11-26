import {
  getLanguage,
  getSupportedLanguages,
  setLanguage,
  type Language,
} from "@fairshare/domain";

const STORAGE_KEY = "fairshare-language";

export { getLanguage, getSupportedLanguages, type Language };

function syncDocumentLang(language: Language): void {
  document.documentElement.lang = language;
}

export function initLanguage(): void {
  const stored = localStorage.getItem(STORAGE_KEY);
  const supported = getSupportedLanguages();
  if (stored && supported.includes(stored as Language)) {
    setLanguage(stored as Language);
  } else {
    const browser = navigator.language?.split("-")[0];
    if (browser && supported.includes(browser as Language)) {
      setLanguage(browser as Language);
    }
  }
  syncDocumentLang(getLanguage());
}

export function saveLanguage(language: Language): void {
  setLanguage(language);
  localStorage.setItem(STORAGE_KEY, language);
  syncDocumentLang(language);
}
