import { describe, expect, it } from "vitest";
import { addExpense, addPerson, createTrip } from "@fairshare/domain/trip";
import { expenseCards } from "../src/screens/trip";

describe("expenseCards", () => {
  it("escapes free-text note and category from a shared trip", () => {
    let trip = addPerson(addPerson(createTrip("Trip"), "Ana"), "Bo");
    trip = addExpense(
      trip,
      {
        description: "Dinner",
        amount_cents: 1000,
        payer: "Ana",
        participants: ["Ana", "Bo"],
        category: "<b>cat</b>",
        note: '<img src=x onerror="alert(1)">',
      },
      "e1",
    );
    const html = expenseCards(trip);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>cat</b>");
    expect(html).toContain("&lt;img src=x");
  });
});
