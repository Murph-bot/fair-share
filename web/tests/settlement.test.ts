import { describe, expect, it } from "vitest";
import { settle } from "../src/domain/settlement";

describe("settle", () => {
  it("settles two people in one payment", () => {
    const payments = settle({ Alice: 1000, Bob: -1000 });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toEqual({ frm: "Bob", to: "Alice", amount_cents: 1000 });
  });

  it("covers a three-person split", () => {
    const payments = settle({ Alice: 6000, Bob: -3000, Charlie: -3000 });
    expect(payments.reduce((s, p) => s + p.amount_cents, 0)).toBe(6000);
    for (const p of payments) {
      expect(p.amount_cents).toBeGreaterThan(0);
    }
  });

  it("returns nothing when already settled", () => {
    expect(settle({ Alice: 0, Bob: 0 })).toEqual([]);
    expect(settle({})).toEqual([]);
  });

  it("returns nothing with only a credit", () => {
    expect(settle({ Alice: 1000 })).toEqual([]);
  });

  it("fully settles a four-person case", () => {
    const balances = { Alice: 10000, Bob: -3000, Charlie: -4000, Dave: -3000 };
    const payments = settle(balances);
    const cash: Record<string, number> = {};
    for (const p of payments) {
      cash[p.frm] = (cash[p.frm] ?? 0) + p.amount_cents;
      cash[p.to] = (cash[p.to] ?? 0) - p.amount_cents;
    }
    for (const [person, original] of Object.entries(balances)) {
      expect(original + (cash[person] ?? 0)).toBe(0);
    }
  });
});
