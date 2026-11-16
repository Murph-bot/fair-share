import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "@fairshare/domain";
import { appPath } from "../src/paths";
import { privacyHtml } from "../src/screens/privacy";

describe("privacy page", () => {
  afterEach(() => setLanguage("en"));

  it("names the controller, contact, retention and the Greek authority", () => {
    const html = privacyHtml();

    expect(html).toContain("Sotirios Goulas");
    expect(html).toContain('href="mailto:sotirios.k.goulas@gmail.com"');
    expect(html).toContain("12 months");
    expect(html).toContain("https://www.dpa.gr");
    expect(html).toContain("Last updated: 16 November 2026");
  });

  it("is served in Greek when the language is Greek", () => {
    setLanguage("el");

    const html = privacyHtml();

    expect(html).toContain("12 μήνες");
    expect(html).toContain("Τελευταία ενημέρωση: 16 Νοεμβρίου 2026");
  });

  it("routes under the /fairshare mount as well as at the root", () => {
    expect(appPath("/privacy", "https://fair-share-trips.pages.dev/")).toBe("/privacy");
    expect(appPath("/fairshare/privacy", "https://pithelo.com/fairshare/")).toBe("/privacy");
  });
});
