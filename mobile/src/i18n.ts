import { useCallback, useEffect, useState } from "react";
import { getLocales } from "expo-localization";
import { getLanguage, getSupportedLanguages, setLanguage, t, type Language } from "./domain";

export function initLanguage(): Language {
  const supported = getSupportedLanguages();
  const device = getLocales()[0]?.languageCode;
  if (device && supported.includes(device as Language)) {
    setLanguage(device as Language);
    return device as Language;
  }
  return getLanguage();
}

export function useTranslation() {
  const [language, setLang] = useState<Language>(getLanguage());

  useEffect(() => {
    setLang(initLanguage());
  }, []);

  const changeLanguage = useCallback((next: Language) => {
    setLanguage(next);
    setLang(next);
  }, []);

  return { t, language, changeLanguage };
}
