export type Payment = {
  readonly frm: string;
  readonly to: string;
  readonly amount_cents: number;
};

export function settle(balances: Record<string, number>): Payment[] {
  const net: Record<string, number> = {};
  for (const [person, amount] of Object.entries(balances)) {
    if (amount !== 0) {
      net[person] = amount;
    }
  }

  const payments: Payment[] = [];

  while (true) {
    const debtors = Object.entries(net)
      .filter(([, b]) => b < 0)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const creditors = Object.entries(net)
      .filter(([, b]) => b > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    if (debtors.length === 0 || creditors.length === 0) {
      break;
    }

    const [debtor, debtAmt] = debtors[0];
    const [creditor, credAmt] = creditors[0];
    const amount = Math.min(-debtAmt, credAmt);
    payments.push({ frm: debtor, to: creditor, amount_cents: amount });

    net[debtor] += amount;
    net[creditor] -= amount;

    if (net[debtor] === 0) {
      delete net[debtor];
    }
    if (net[creditor] === 0) {
      delete net[creditor];
    }
  }

  return payments;
}
