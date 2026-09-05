import { describe, expect, it } from "vitest";
import { ExpenseNotFoundError, ValidationError } from "@fairshare/domain/errors";
import { computeBalances } from "@fairshare/domain/balances";
import {
  addExpense,
  addPerson,
  createTrip,
  movePerson,
  parseTrip,
  removeExpense,
  renamePerson,
  tripFileJson,
  updateExpense,
  type Trip,
} from "@fairshare/domain/trip";

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

  it("updates an expense in place and keeps the same id", () => {
    const expenseId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    trip = addExpense(
      trip,
      {
        description: "Dinner",
        payer: "Alice",
        amount_cents: 6000,
        participants: ["Alice", "Bob"],
      },
      expenseId,
    );
    const updated = updateExpense(trip, expenseId, {
      description: "Lunch",
      payer: "bob",
      amount_cents: 2000,
      participants: ["Alice", "Bob"],
    });
    expect(updated.expenses).toHaveLength(1);
    expect(updated.expenses[0].id).toBe(expenseId);
    expect(updated.expenses[0]).toEqual({
      id: expenseId,
      description: "Lunch",
      payer: "Bob",
      amount_cents: 2000,
      participants: ["Alice", "Bob"],
    });
    expect(trip.expenses[0].description).toBe("Dinner");
    expect(trip.expenses[0].amount_cents).toBe(6000);
    expect(computeBalances(updated)).toEqual({ Alice: -1000, Bob: 1000 });
  });

  it("updates an expense by unique id prefix", () => {
    let trip = addPerson(createTrip("T"), "Alice");
    trip = addExpense(
      trip,
      { description: "Coffee", payer: "Alice", amount_cents: 300, participants: ["Alice"] },
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    trip = updateExpense(trip, "aaaaaaaa", {
      description: "Tea",
      payer: "Alice",
      amount_cents: 400,
      participants: ["Alice"],
    });
    expect(trip.expenses[0].description).toBe("Tea");
    expect(trip.expenses[0].id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("clears weights when an update omits them", () => {
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    trip = addExpense(
      trip,
      {
        description: "Hotel",
        payer: "Alice",
        amount_cents: 9000,
        participants: ["Alice", "Bob"],
        weights: [2, 1],
      },
      "hotel-id",
    );
    trip = updateExpense(trip, "hotel-id", {
      description: "Hotel",
      payer: "Alice",
      amount_cents: 9000,
      participants: ["Alice", "Bob"],
    });
    expect(trip.expenses[0].weights).toBeUndefined();
  });

  it("rejects updating a missing expense", () => {
    expect(() =>
      updateExpense(createTrip("T"), "nope", {
        description: "X",
        payer: "Alice",
        amount_cents: 100,
        participants: ["Alice"],
      }),
    ).toThrow(ExpenseNotFoundError);
  });

  it("rejects an ambiguous expense id prefix on update", () => {
    let trip = addPerson(createTrip("T"), "Alice");
    trip = addExpense(
      trip,
      { description: "A", payer: "Alice", amount_cents: 100, participants: ["Alice"] },
      "aaaa-1111",
    );
    trip = addExpense(
      trip,
      { description: "B", payer: "Alice", amount_cents: 100, participants: ["Alice"] },
      "aaaa-2222",
    );
    expect(() =>
      updateExpense(trip, "aaaa", {
        description: "C",
        payer: "Alice",
        amount_cents: 100,
        participants: ["Alice"],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects an empty expense id on update", () => {
    const trip = addPerson(createTrip("T"), "Alice");
    expect(() =>
      updateExpense(trip, "  ", {
        description: "X",
        payer: "Alice",
        amount_cents: 100,
        participants: ["Alice"],
      }),
    ).toThrow(ValidationError);
  });

  it("rejects unknown payers on update", () => {
    let trip = addPerson(createTrip("T"), "Alice");
    trip = addExpense(
      trip,
      { description: "X", payer: "Alice", amount_cents: 100, participants: ["Alice"] },
      "id-1",
    );
    expect(() =>
      updateExpense(trip, "id-1", {
        description: "X",
        payer: "Zara",
        amount_cents: 100,
        participants: ["Alice"],
      }),
    ).toThrow();
  });

  it("renames a person and updates expenses", () => {
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    trip = addExpense(
      trip,
      {
        description: "Dinner",
        payer: "Alice",
        amount_cents: 6000,
        participants: ["Alice", "Bob"],
      },
      "id-1",
    );
    trip = renamePerson(trip, "Alice", "Alicia");
    expect(trip.people).toEqual(["Alicia", "Bob"]);
    expect(trip.expenses[0].payer).toBe("Alicia");
    expect(trip.expenses[0].participants).toEqual(["Alicia", "Bob"]);
    expect(trip.expenses[0].weights).toBeUndefined();
  });

  it("rejects renaming to an existing person", () => {
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    expect(() => renamePerson(trip, "Alice", "Bob")).toThrow(ValidationError);
  });

  it("reorders people", () => {
    let trip = addPerson(addPerson(addPerson(createTrip("T"), "Alice"), "Bob"), "Charlie");
    trip = movePerson(trip, "Charlie", "up");
    expect(trip.people).toEqual(["Alice", "Charlie", "Bob"]);
    trip = movePerson(trip, "Alice", "down");
    expect(trip.people).toEqual(["Charlie", "Alice", "Bob"]);
  });

  it("ignores moving the first person up or the last person down", () => {
    let trip = addPerson(addPerson(createTrip("T"), "Alice"), "Bob");
    expect(movePerson(trip, "Alice", "up").people).toEqual(["Alice", "Bob"]);
    expect(movePerson(trip, "Bob", "down").people).toEqual(["Alice", "Bob"]);
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

  it("exports money fields only and round-trips through parseTrip", () => {
    const trip = parseTrip({
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
    });
    const raw = JSON.parse(
      tripFileJson({ ...trip, photos_locked: true, pin_hash: "nope" } as Trip & {
        photos_locked: boolean;
        pin_hash: string;
      }),
    );
    expect(raw).toEqual({
      schema_version: 1,
      name: "Athens",
      people: ["Alice", "Bob"],
      expenses: trip.expenses,
    });
    expect("photos_locked" in raw).toBe(false);
    expect("pin_hash" in raw).toBe(false);
    expect(parseTrip(raw)).toEqual(trip);
  });
});
