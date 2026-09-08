import { equalSplit, weightedSplit } from "./splitter";
import { effectiveAmountCents, type Expense, type Trip } from "./trip";

export type TripStats = {
  totalCents: number;
  expenseCount: number;
  largestExpense: Expense | null;
  paidBy: Record<string, number>;
};

export function computeStats(trip: Trip): TripStats {
  const paidBy: Record<string, number> = {};
  let totalCents = 0;
  let largestExpense: Expense | null = null;
  for (const expense of trip.expenses) {
    const amount = effectiveAmountCents(expense);
    totalCents += amount;
    paidBy[expense.payer] = (paidBy[expense.payer] ?? 0) + amount;
    if (largestExpense === null || amount > effectiveAmountCents(largestExpense)) {
      largestExpense = expense;
    }
  }
  return {
    totalCents,
    expenseCount: trip.expenses.length,
    largestExpense,
    paidBy,
  };
}

export function computeBalances(trip: Trip): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const person of trip.people) {
    balances[person] = 0;
  }

  for (const expense of trip.expenses) {
    const total = effectiveAmountCents(expense);
    balances[expense.payer] = (balances[expense.payer] ?? 0) + total;

    const n = expense.participants.length;
    const shares =
      expense.weights !== undefined
        ? weightedSplit(total, expense.weights)
        : equalSplit(total, n);

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
