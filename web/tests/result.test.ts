import { describe, expect, it } from "vitest";
import { computeBalances, createExampleTrip, effectiveAmountCents } from "@fairshare/domain";
import { buildResult, evenBarSegments, formatMoney, initials, netStatus, settleSentence } from "../src/result";

describe("formatMoney", () => {
  it("formats EUR in Greek with decimal comma", () => {
    expect(formatMoney(1240, "EUR", "el").replace(/\s/g, " ")).toBe("12,40 €");
  });
  it("formats EUR in English", () => {
    expect(formatMoney(1240, "EUR", "en")).toBe("€12.40");
  });
  it("adds explicit signs", () => {
    expect(formatMoney(-810, "EUR", "en", { signed: true })).toBe("\u2212€8.10");
    expect(formatMoney(810, "EUR", "en", { signed: true })).toBe("+€8.10");
    expect(formatMoney(0, "EUR", "en", { signed: true })).toBe("€0.00");
  });
});

describe("settleSentence", () => {
  it("builds the Greek sentence with articles and accusative", () => {
    expect(settleSentence("Μαρία", "Νίκος", 1240, "EUR", "el").replace(/\s/g, " ")).toBe("Η Μαρία δίνει στον Νίκο 12,40 €");
  });
  it("falls back for Latin names in Greek", () => {
    expect(settleSentence("Maria", "Nikos", 1240, "EUR", "el").replace(/\s/g, " ")).toBe("Maria δίνει σε Nikos 12,40 €");
  });
  it("builds the English sentence", () => {
    expect(settleSentence("Maria", "Nikos", 1240, "EUR", "en")).toBe("Maria pays Nikos €12.40");
  });
});

describe("helpers", () => {
  it("initials", () => {
    expect(initials("Maria K.")).toBe("MK");
    expect(initials("Νίκος")).toBe("ΝΙ");
    expect(initials("")).toBe("?");
  });
  it("netStatus", () => {
    expect(netStatus(5)).toBe("gets");
    expect(netStatus(-5)).toBe("owes");
    expect(netStatus(0)).toBe("square");
  });
});

describe("buildResult", () => {
  const trip = createExampleTrip("Demo");
  const r = buildResult(trip, "en");
  it("nets match the domain balances", () => {
    const b = computeBalances(trip);
    for (const p of r.people) expect(p.netCents).toBe(b[p.name]);
  });
  it("shares sum back to the total", () => {
    const total = trip.expenses.reduce((s, e) => s + effectiveAmountCents(e), 0);
    expect(r.people.reduce((s, p) => s + p.shareCents, 0)).toBe(total);
    expect(r.totalCents).toBe(total);
  });
  it("Even Bar percents sum to 100 and follow weights", () => {
    const sum = r.segments.reduce((s, x) => s + x.percent, 0);
    expect(sum).toBeCloseTo(100, 6);
    const segs = evenBarSegments([
      { name: "A", initials: "A", fruit: "mango", shape: 0, paidCents: 0, shareCents: 200, netCents: 0, status: "square" },
      { name: "B", initials: "B", fruit: "kiwi", shape: 1, paidCents: 0, shareCents: 100, netCents: 0, status: "square" },
    ]);
    expect(segs[0].percent).toBeCloseTo(66.667, 2);
    expect(segs[1].percent).toBeCloseTo(33.333, 2);
  });
  it("empty trip gives equal segments", () => {
    const segs = evenBarSegments([
      { name: "A", initials: "A", fruit: "mango", shape: 0, paidCents: 0, shareCents: 0, netCents: 0, status: "square" },
      { name: "B", initials: "B", fruit: "kiwi", shape: 1, paidCents: 0, shareCents: 0, netCents: 0, status: "square" },
    ]);
    expect(segs.map((s) => s.percent)).toEqual([50, 50]);
  });
  it("receipt ends with the transfers", () => {
    const transfers = r.receipt.filter((l) => l.kind === "transfer");
    expect(transfers.length).toBe(r.transfers.length);
  });
});
