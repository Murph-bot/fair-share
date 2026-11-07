import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appPath, tripIdFromLink } from "../src/paths";

const ROOT = "https://fair-share-trips.pages.dev/";
const MOUNTED = "https://pithelo.com/fairshare/";
const ID = "ff4765be974564a2503e8f94f67538dd";

describe("appPath", () => {
  it("is the pathname itself when the app is at the root", () => {
    expect(appPath("/", ROOT)).toBe("/");
    expect(appPath(`/t/${ID}`, ROOT)).toBe(`/t/${ID}`);
    expect(appPath(`/t/${ID}/`, ROOT)).toBe(`/t/${ID}`);
  });

  it("removes the base when the app is mounted", () => {
    expect(appPath("/fairshare", MOUNTED)).toBe("/");
    expect(appPath("/fairshare/", MOUNTED)).toBe("/");
    expect(appPath(`/fairshare/t/${ID}`, MOUNTED)).toBe(`/t/${ID}`);
  });

  it("only removes a whole path segment", () => {
    expect(appPath("/fairshared", MOUNTED)).toBe("/fairshared");
  });
});

describe("tripIdFromLink", () => {
  it("reads trip links from both addresses", () => {
    expect(tripIdFromLink(`https://fair-share-trips.pages.dev/t/${ID}`)).toBe(ID);
    expect(tripIdFromLink(`https://pithelo.com/fairshare/t/${ID}`)).toBe(ID);
    expect(tripIdFromLink(`https://pithelo.com/fairshare/t/${ID.toUpperCase()}/`)).toBe(ID);
  });

  it("rejects anything that is not a trip link", () => {
    expect(tripIdFromLink("https://pithelo.com/fairshare/")).toBeNull();
    expect(tripIdFromLink("https://pithelo.com/t/123")).toBeNull();
    expect(tripIdFromLink("not a url")).toBeNull();
  });
});

describe("client source", () => {
  it("never uses a root-absolute app URL, which would escape the mount", () => {
    const dirs = ["../src/", "../src/screens/"].map((d) => new URL(d, import.meta.url));
    const files = dirs.flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => new URL(name, dir)),
    );
    const rootAbsolute = /fetch\(["'`]\/|pushState\([^)]*["'`]\/|(?:href|src)="\/|register\(["'`]\//;
    const offenders = files.filter((file) => rootAbsolute.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.pathname)).toEqual([]);
  });
});
