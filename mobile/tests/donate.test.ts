import { describe, expect, it } from "vitest";

import { resolveDonateUrl } from "../src/utils/donate";

describe("resolveDonateUrl", () => {
  it("prefers the public env var", () => {
    expect(
      resolveDonateUrl(
        { EXPO_PUBLIC_DONATE_URL: "https://ko-fi.com/fairshare" },
        { donateUrl: "https://example.com/other" },
      ),
    ).toBe("https://ko-fi.com/fairshare");
  });

  it("falls back to extra.donateUrl", () => {
    expect(resolveDonateUrl({}, { donateUrl: "https://github.com/sponsors/example" })).toBe(
      "https://github.com/sponsors/example",
    );
  });

  it("hides the button when unset or not https", () => {
    expect(resolveDonateUrl({}, {})).toBeNull();
    expect(resolveDonateUrl({ EXPO_PUBLIC_DONATE_URL: "   " }, { donateUrl: "" })).toBeNull();
    expect(resolveDonateUrl({ EXPO_PUBLIC_DONATE_URL: "http://example.com" }, {})).toBeNull();
    expect(resolveDonateUrl({ EXPO_PUBLIC_DONATE_URL: "javascript:alert(1)" }, {})).toBeNull();
    expect(
      resolveDonateUrl({ EXPO_PUBLIC_DONATE_URL: "not a url" }, { donateUrl: "https://ko-fi.com/fairshare" }),
    ).toBe("https://ko-fi.com/fairshare");
  });
});
