import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(root, "..");

describe("store config", () => {
  it("declares identifiers without committing native projects", () => {
    const app = JSON.parse(readFileSync(join(mobileRoot, "app.json"), "utf8")) as {
      expo: {
        ios?: { bundleIdentifier?: string; buildNumber?: string; infoPlist?: Record<string, unknown> };
        android?: { package?: string; versionCode?: number };
        extra?: { donateUrl?: unknown };
        plugins?: unknown[];
      };
    };

    expect(app.expo.ios?.bundleIdentifier).toMatch(/^[a-z][a-z0-9.]+$/);
    expect(app.expo.android?.package).toMatch(/^[a-z][a-z0-9.]+$/);
    expect(app.expo.ios?.buildNumber).toBeTruthy();
    expect(app.expo.android?.versionCode).toBeGreaterThan(0);
    expect(app.expo.ios?.infoPlist?.NSPhotoLibraryUsageDescription).toEqual(expect.any(String));
    expect(app.expo.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(app.expo.extra ?? {}, "donateUrl")).toBe(true);

    const plugins = JSON.stringify(app.expo.plugins ?? []);
    expect(plugins).toContain("expo-image-picker");
    expect(plugins).toContain("expo-secure-store");

    expect(existsSync(join(mobileRoot, "ios"))).toBe(false);
    expect(existsSync(join(mobileRoot, "android"))).toBe(false);
  });

  it("has EAS managed build profiles", () => {
    const eas = JSON.parse(readFileSync(join(mobileRoot, "eas.json"), "utf8")) as {
      build?: { development?: unknown; preview?: unknown; production?: unknown };
    };
    expect(eas.build?.development).toBeTruthy();
    expect(eas.build?.preview).toBeTruthy();
    expect(eas.build?.production).toBeTruthy();
  });
});
