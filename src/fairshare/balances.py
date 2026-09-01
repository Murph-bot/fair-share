"""Compute net balances for a trip."""

from __future__ import annotations

from fairshare.models import Trip
from fairshare.splitter import equal_split, weighted_split


def compute_balances(trip: Trip) -> dict[str, int]:
    """Return a mapping of person → net balance in cents.

    Positive means owed money (creditor), negative means owes money (debtor).
    The sum of all balances is always 0. People on the trip with no expenses
    are included at 0.
    """
    balances: dict[str, int] = {person: 0 for person in trip.people}

    for expense in trip.expenses:
        balances[expense.payer] = balances.get(expense.payer, 0) + expense.amount_cents

        n = len(expense.participants)
        if expense.weights is not None:
            shares = weighted_split(expense.amount_cents, list(expense.weights))
        else:
            shares = equal_split(expense.amount_cents, n)

        for person, share in zip(expense.participants, shares, strict=True):
            balances[person] = balances.get(person, 0) - share

    return balances
