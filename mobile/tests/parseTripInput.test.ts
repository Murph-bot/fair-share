import { describe, expect, it } from "vitest";

import { parseTripInput } from "../src/utils/parseTripInput";

describe("parseTripInput", () => {
  it("accepts a bare trip id", () => {
    const result = parseTripInput("  ff4765be974564a2503e8f94f67538dd  ");
    expect(result).toEqual({ ok: true, id: "ff4765be974564a2503e8f94f67538dd" });
  });

  it("accepts web links and deep links", () => {
    expect(parseTripInput("https://fair-share-trips.netlify.app/t/ff4765be974564a2503e8f94f67538dd")).toEqual({
      ok: true,
      id: "ff4765be974564a2503e8f94f67538dd",
    });
    expect(parseTripInput("fairshare://t/ff4765be974564a2503e8f94f67538dd")).toEqual({
      ok: true,
      id: "ff4765be974564a2503e8f94f67538dd",
    });
  });

  it("rejects invalid input", () => {
    expect(parseTripInput("")).toEqual({ ok: false, error: "Enter a trip ID or link" });
    expect(parseTripInput("not a trip")).toEqual({ ok: false, error: "Paste a trip ID or /t/<id> link" });
    expect(parseTripInput("https://fair-share-trips.netlify.app/t/123")).toEqual({
      ok: false,
      error: "Paste a trip ID or /t/<id> link",
    });
  });
});
