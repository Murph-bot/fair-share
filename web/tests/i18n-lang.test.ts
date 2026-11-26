import { afterEach, describe, expect, it } from "vitest";
import { getLanguage, initLanguage, saveLanguage } from "../src/i18n";

const memory = new Map<string, string>();

function installDom(lang = "en", browser = "en-US"): void {
  memory.clear();
  const html = { lang };
  (globalThis as unknown as { document: { documentElement: { lang: string } } }).document = {
    documentElement: html,
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  } as Storage;
  Object.defineProperty(globalThis, "navigator", {
    value: { language: browser },
    configurable: true,
  });
}

afterEach(() => {
  saveLanguage("en");
  memory.clear();
});

describe("html lang follows the language toggle", () => {
  it("sets html lang to el when switched to Greek, and back to en", () => {
    installDom("en");
    initLanguage();
    expect(getLanguage()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    saveLanguage("el");
    expect(document.documentElement.lang).toBe("el");
    saveLanguage("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("applies a stored Greek preference on startup", () => {
    installDom("en");
    memory.set("fairshare-language", "el");
    initLanguage();
    expect(getLanguage()).toBe("el");
    expect(document.documentElement.lang).toBe("el");
  });
});
