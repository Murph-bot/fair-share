"""Greedy min-cash-flow settlement algorithm."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Payment:
    """A single settlement payment: *frm* pays *amount_cents* to *to*."""

    frm: str
    to: str
    amount_cents: int


def settle(balances: dict[str, int]) -> list[Payment]:
    """Compute the minimum cash-flow settlement using a greedy algorithm.

    Always pairs the largest debtor with the largest creditor.
    Note: this is a greedy heuristic and may not be globally optimal
    for all balance distributions, but it is fast and produces a small
    number of transactions in practice.

    Balances with zero value are ignored.
    """
    # Work with mutable copies, filtering out zeros
    net = {p: b for p, b in balances.items() if b != 0}
    payments: list[Payment] = []

    while True:
        debtors = sorted(((b, p) for p, b in net.items() if b < 0), key=lambda x: x[0])
        creditors = sorted(((b, p) for p, b in net.items() if b > 0), key=lambda x: -x[0])

        if not debtors or not creditors:
            break

        debt_amt, debtor = debtors[0]
        cred_amt, creditor = creditors[0]

        amount = min(-debt_amt, cred_amt)
        payments.append(Payment(frm=debtor, to=creditor, amount_cents=amount))

        net[debtor] += amount
        net[creditor] -= amount

        if net[debtor] == 0:
            del net[debtor]
        if net[creditor] == 0:
            del net[creditor]

    return payments
