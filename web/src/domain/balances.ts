import { equalSplit, weightedSplit } from "./splitter";
import type { Trip } from "./trip";

export function computeBalances(trip: Trip): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const person of trip.people) {
    balances[person] = 0;
  }

  for (const expense of trip.expenses) {
    balances[expense.payer] = (balances[expense.payer] ?? 0) + expense.amount_cents;

    const n = expense.participants.length;
    const shares =
      expense.weights !== undefined
        ? weightedSplit(expense.amount_cents, expense.weights)
        : equalSplit(expense.amount_cents, n);

    if (shares.length !== n) {
      throw new Error(`share count ${shares.length} does not match participants ${n}`);
    }

    for (let i = 0; i < n; i++) {
      const person = expense.participants[i];
      balances[person] = (balances[person] ?? 0) - shares[i];
    }
  }

  return balances;
}
