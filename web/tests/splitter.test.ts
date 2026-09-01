import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/errors";
import { equalSplit, weightedSplit } from "../src/domain/splitter";

describe("equalSplit", () => {
  it("divides evenly", () => {
    expect(equalSplit(9000, 3)).toEqual([3000, 3000, 3000]);
  });
  it("sums to total", () => {
    expect(equalSplit(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("gives remainder to the first people", () => {
    expect(equalSplit(10, 3)).toEqual([4, 3, 3]);
  });
  it("handles a single participant", () => {
    expect(equalSplit(5000, 1)).toEqual([5000]);
  });
  it("splits odd cents across two people", () => {
    expect(equalSplit(101, 2)).toEqual([51, 50]);
  });
  it("spreads several remainder cents", () => {
    const shares = equalSplit(7, 5);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(7);
    expect(shares[0]).toBe(2);
    expect(shares[1]).toBe(2);
    expect(shares[2]).toBe(1);
  });
  it("rejects zero amount", () => {
    expect(() => equalSplit(0, 3)).toThrow(ValidationError);
  });
  it("rejects n < 1", () => {
    expect(() => equalSplit(100, 0)).toThrow(ValidationError);
  });
});

describe("weightedSplit", () => {
  it("matches equal split when weights are equal", () => {
    expect(weightedSplit(9000, [1, 1, 1])).toEqual([3000, 3000, 3000]);
  });
  it("sums to total", () => {
    expect(weightedSplit(100, [2, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("splits proportionally", () => {
    expect(weightedSplit(100, [2, 1, 1])).toEqual([50, 25, 25]);
  });
  it("uses integer Hamilton remainders", () => {
    const amount = 10;
    const weights = [1, 1, 1];
    const total = weights.reduce((a, b) => a + b, 0);
    const floors = weights.map((w) => Math.floor((amount * w) / total));
    const remainders = weights.map((w) => (amount * w) % total);
    let leftover = amount - floors.reduce((a, b) => a + b, 0);
    const order = [...weights.keys()].sort((i, j) => remainders[j] - remainders[i] || i - j);
    for (let k = 0; k < leftover; k++) {
      floors[order[k]] += 1;
    }
    expect(weightedSplit(amount, weights)).toEqual(floors);
  });
  it("handles hotel-style 2:1:1", () => {
    expect(weightedSplit(9000, [2, 1, 1])).toEqual([4500, 2250, 2250]);
  });
  it("handles awkward ratios", () => {
    expect(weightedSplit(1, [1, 2, 3])).toEqual([0, 0, 1]);
  });
  it("rejects empty weights", () => {
    expect(() => weightedSplit(100, [])).toThrow(ValidationError);
  });
  it("rejects a zero weight", () => {
    expect(() => weightedSplit(100, [1, 0])).toThrow(ValidationError);
  });
});
