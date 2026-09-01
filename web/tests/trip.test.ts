import { describe, expect, it } from "vitest";
import { ExpenseNotFoundError, ValidationError } from "../src/domain/errors";
import {
  addExpense,
  addPerson,
  createTrip,
  parseTrip,
  removeExpense,
} from "../src/domain/trip";

describe("trip operations", () => {
  it("creates a named trip", () => {
    const trip = createTrip(" Weekend ");
    expect(trip.name).toBe("Weekend");
    expect(trip.people).toEqual([]);
    expect(trip.expenses).toEqual([]);
  });

  it("rejects an empty trip name", () => {
    expect(() => createTrip("   ")).toThrow(ValidationError);
  });

  it("adds people and ignores case-insensitive duplicates", () => {
    let trip = createTrip("T");
    trip = addPerson(trip, "Alice");
    trip = addPerson(trip, "ALICE");
    expect(trip.people).toEqual(["Alice"]);
  });

  it("rejects commas in names", () => {
    expect(() => addPerson(createTrip("T"), "Alice,Bob")).toThrow(ValidationError);
  });

  it("adds and removes an expense", () => {
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    trip = addExpense(
      trip,
      {
        description: "Dinner",
        payer: "alice",
        amount_cents: 6000,
        participants: ["Alice", "Bob"],
      },
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(trip.expenses).toHaveLength(1);
    trip = removeExpense(trip, "aaaaaaaa");
    expect(trip.expenses).toEqual([]);
  });

  it("rejects unknown payers", () => {
    const trip = addPerson(createTrip("T"), "Alice");
    expect(() =>
      addExpense(
        trip,
        { description: "X", payer: "Zara", amount_cents: 100, participants: ["Alice"] },
        "id",
      ),
    ).toThrow();
  });

  it("rejects removing a missing expense", () => {
    expect(() => removeExpense(createTrip("T"), "nope")).toThrow(ExpenseNotFoundError);
  });

  it("round-trips JSON through parseTrip", () => {
    const raw = {
      schema_version: 1,
      name: "Athens",
      people: ["Alice", "Bob"],
      expenses: [
        {
          id: "x",
          description: "Dinner",
          payer: "Alice",
          amount_cents: 1000,
          participants: ["Alice", "Bob"],
        },
      ],
    };
    const trip = parseTrip(raw);
    expect(trip.name).toBe("Athens");
    expect(trip.expenses[0].amount_cents).toBe(1000);
    expect("pin_hash" in trip).toBe(false);
  });

  it("ignores a stored PIN hash", () => {
    const trip = parseTrip({
      schema_version: 1,
      name: "Athens",
      pin_hash: "should-not-leak",
      people: ["Alice"],
      expenses: [],
    });
    expect(trip).toEqual({
      schema_version: 1,
      name: "Athens",
      people: ["Alice"],
      expenses: [],
    });
  });

  it("rejects empty participants in stored JSON", () => {
    expect(() =>
      parseTrip({
        schema_version: 1,
        name: "t",
        people: ["Alice"],
        expenses: [
          { id: "x", description: "Ghost", payer: "Alice", amount_cents: 100, participants: [] },
        ],
      }),
    ).toThrow(/Select at least one person/);
  });
});
