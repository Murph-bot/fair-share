"""Compute net balances for a trip."""

from __future__ import annotations

from fairshare.models import Trip
from fairshare.splitter import equal_split, weighted_split


def compute_balances(trip: Trip) -> dict[str, int]:
    """Return a mapping of person → net balance in cents.

    Positive means owed money (creditor), negative means owes money (debtor).
    The sum of all balances is always 0.
    """
    balances: dict[str, int] = {}

    for expense in trip.expenses:
        # Credit the payer for the full amount
        balances[expense.payer] = balances.get(expense.payer, 0) + expense.amount_cents

        # Compute each participant's share
        n = len(expense.participants)
        if expense.weights is not None:
            shares = weighted_split(expense.amount_cents, list(expense.weights))
        else:
            shares = equal_split(expense.amount_cents, n)

        # Debit each participant their share
        for person, share in zip(expense.participants, shares):
            balances[person] = balances.get(person, 0) - share

    return balances
