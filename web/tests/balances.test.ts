import { describe, expect, it } from "vitest";
import { computeBalances } from "@fairshare/domain/balances";
import { ValidationError } from "@fairshare/domain/errors";
import type { Expense, Trip } from "@fairshare/domain/trip";
import { parseTrip } from "@fairshare/domain/trip";

function tripWith(expenses: Expense[], extraPeople: string[] = []): Trip {
  const people: string[] = [];
  for (const e of expenses) {
    for (const p of [e.payer, ...e.participants]) {
      if (!people.includes(p)) {
        people.push(p);
      }
    }
  }
  for (const p of extraPeople) {
    if (!people.includes(p)) {
      people.push(p);
    }
  }
  return { schema_version: 1, name: "Test", people, expenses };
}

describe("computeBalances", () => {
  it("splits one equal expense", () => {
    const trip = tripWith([
      {
        id: "1",
        description: "Dinner",
        payer: "Alice",
        amount_cents: 9000,
        participants: ["Alice", "Bob", "Charlie"],
      },
    ]);
    const bal = computeBalances(trip);
    expect(bal.Alice).toBe(6000);
    expect(bal.Bob).toBe(-3000);
    expect(bal.Charlie).toBe(-3000);
    expect(Object.values(bal).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("credits a payer who is not a participant", () => {
    const trip = tripWith([
      {
        id: "1",
        description: "Dinner",
        payer: "Alice",
        amount_cents: 9000,
        participants: ["Bob", "Charlie"],
      },
    ]);
    const bal = computeBalances(trip);
    expect(bal.Alice).toBe(9000);
    expect(bal.Bob).toBe(-4500);
    expect(bal.Charlie).toBe(-4500);
  });

  it("nets multiple expenses", () => {
    const trip = tripWith([
      {
        id: "1",
        description: "Dinner",
        payer: "Alice",
        amount_cents: 6000,
        participants: ["Alice", "Bob"],
      },
      {
        id: "2",
        description: "Taxi",
        payer: "Bob",
        amount_cents: 4000,
        participants: ["Alice", "Bob"],
      },
    ]);
    const bal = computeBalances(trip);
    expect(bal.Alice).toBe(1000);
    expect(bal.Bob).toBe(-1000);
  });

  it("applies weighted hotel shares", () => {
    const trip = tripWith([
      {
        id: "1",
        description: "Hotel",
        payer: "Alice",
        amount_cents: 9000,
        participants: ["Alice", "Bob", "Charlie"],
        weights: [2, 1, 1],
      },
    ]);
    const bal = computeBalances(trip);
    expect(bal.Alice).toBe(4500);
    expect(bal.Bob).toBe(-2250);
    expect(bal.Charlie).toBe(-2250);
  });

  it("includes people with no expenses at zero", () => {
    const trip = tripWith(
      [
        {
          id: "1",
          description: "Dinner",
          payer: "Alice",
          amount_cents: 1000,
          participants: ["Alice", "Bob"],
        },
      ],
      ["Charlie"],
    );
    const bal = computeBalances(trip);
    expect(bal.Charlie).toBe(0);
  });

  it("always sums to zero", () => {
    const trip = tripWith([
      {
        id: "1",
        description: "A",
        payer: "Alice",
        amount_cents: 10001,
        participants: ["Alice", "Bob", "Charlie"],
      },
      {
        id: "2",
        description: "B",
        payer: "Bob",
        amount_cents: 7777,
        participants: ["Bob", "Charlie"],
      },
      {
        id: "3",
        description: "C",
        payer: "Charlie",
        amount_cents: 3333,
        participants: ["Alice", "Charlie"],
        weights: [2, 1],
      },
    ]);
    expect(Object.values(computeBalances(trip)).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("rejects mismatched weights on parse", () => {
    expect(() =>
      parseTrip({
        schema_version: 1,
        name: "t",
        people: ["Alice", "Bob"],
        expenses: [
          {
            id: "1",
            description: "Hotel",
            payer: "Alice",
            amount_cents: 9000,
            participants: ["Alice", "Bob"],
            weights: [2, 1, 1],
          },
        ],
      }),
    ).toThrow(ValidationError);
  });
});
