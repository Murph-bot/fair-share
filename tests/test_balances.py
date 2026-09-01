"""Tests for balances.py — net balance computation."""

import pytest

from fairshare.balances import compute_balances
from fairshare.models import Expense, Trip


def make_trip(expenses):
    people = []
    for e in expenses:
        for p in (e.payer,) + e.participants:
            if p not in people:
                people.append(p)
    return Trip(name="Test", people=tuple(people), expenses=tuple(expenses))


class TestComputeBalances:
    def test_single_expense_equal_split(self):
        # Alice pays $90; Alice, Bob, Charlie each owe $30
        # Alice net: +90 - 30 = +60
        # Bob net: -30
        # Charlie net: -30
        e = Expense(
            id="1",
            description="Dinner",
            payer="Alice",
            amount_cents=9000,
            participants=("Alice", "Bob", "Charlie"),
        )
        trip = make_trip([e])
        bal = compute_balances(trip)
        assert bal["Alice"] == 6000
        assert bal["Bob"] == -3000
        assert bal["Charlie"] == -3000
        assert sum(bal.values()) == 0

    def test_payer_not_in_participants(self):
        # Alice pays $90; only Bob and Charlie participate
        # Alice net: +90 - 0 = +90
        # Bob net: -45
        # Charlie net: -45
        e = Expense(
            id="1",
            description="Dinner",
            payer="Alice",
            amount_cents=9000,
            participants=("Bob", "Charlie"),
        )
        trip = make_trip([e])
        bal = compute_balances(trip)
        assert bal["Alice"] == 9000
        assert bal["Bob"] == -4500
        assert bal["Charlie"] == -4500
        assert sum(bal.values()) == 0

    def test_multiple_expenses(self):
        e1 = Expense(
            id="1",
            description="Dinner",
            payer="Alice",
            amount_cents=6000,
            participants=("Alice", "Bob"),
        )
        e2 = Expense(
            id="2",
            description="Taxi",
            payer="Bob",
            amount_cents=4000,
            participants=("Alice", "Bob"),
        )
        trip = make_trip([e1, e2])
        bal = compute_balances(trip)
        assert sum(bal.values()) == 0
        # Alice: +6000 - 3000 - 2000 = +1000
        # Bob: +4000 - 3000 - 2000 = -1000
        assert bal["Alice"] == 1000
        assert bal["Bob"] == -1000

    def test_weighted_expense(self):
        # Hotel $90, weights Alice=2, Bob=1, Charlie=1 → [4500, 2250, 2250]
        e = Expense(
            id="1",
            description="Hotel",
            payer="Alice",
            amount_cents=9000,
            participants=("Alice", "Bob", "Charlie"),
            weights=(2, 1, 1),
        )
        trip = make_trip([e])
        bal = compute_balances(trip)
        # Alice: +9000 - 4500 = +4500
        # Bob: -2250
        # Charlie: -2250
        assert bal["Alice"] == 4500
        assert bal["Bob"] == -2250
        assert bal["Charlie"] == -2250
        assert sum(bal.values()) == 0

    def test_zero_balances_no_expenses(self):
        trip = Trip(name="Empty", people=("Alice", "Bob"))
        bal = compute_balances(trip)
        assert bal == {"Alice": 0, "Bob": 0}

    def test_person_not_on_any_expense_stays_zero(self):
        e = Expense(
            id="1",
            description="Dinner",
            payer="Alice",
            amount_cents=1000,
            participants=("Alice", "Bob"),
        )
        trip = Trip(name="Test", people=("Alice", "Bob", "Charlie"), expenses=(e,))
        bal = compute_balances(trip)
        assert bal["Charlie"] == 0
        assert sum(bal.values()) == 0

    def test_mismatched_weights_raise(self):
        from fairshare.errors import ValidationError
        from fairshare.models import Expense as ExpenseModel

        with pytest.raises(ValidationError):
            ExpenseModel(
                id="1",
                description="Hotel",
                payer="Alice",
                amount_cents=9000,
                participants=("Alice", "Bob"),
                weights=(2, 1, 1),
            )

    def test_empty_participants_raise(self):
        from fairshare.errors import ValidationError

        with pytest.raises(ValidationError):
            Expense(
                id="1",
                description="Ghost",
                payer="Alice",
                amount_cents=100,
                participants=(),
            )

    def test_zero_amount_raise(self):
        from fairshare.errors import ValidationError

        with pytest.raises(ValidationError):
            Expense(
                id="1",
                description="Zero",
                payer="Alice",
                amount_cents=0,
                participants=("Alice",),
            )

    def test_non_positive_weights_raise(self):
        from fairshare.errors import ValidationError

        with pytest.raises(ValidationError):
            Expense(
                id="1",
                description="Hotel",
                payer="Alice",
                amount_cents=100,
                participants=("Alice", "Bob"),
                weights=(1, 0),
            )

    def test_everyone_owes_zero_when_split_perfectly(self):
        # Two expenses that cancel out
        e1 = Expense(
            id="1",
            description="A",
            payer="Alice",
            amount_cents=5000,
            participants=("Alice", "Bob"),
        )
        e2 = Expense(
            id="2",
            description="B",
            payer="Bob",
            amount_cents=5000,
            participants=("Alice", "Bob"),
        )
        trip = make_trip([e1, e2])
        bal = compute_balances(trip)
        assert bal["Alice"] == 0
        assert bal["Bob"] == 0

    def test_balance_sum_always_zero(self):
        """Property: sum of all balances is always 0."""
        expenses = [
            Expense("1", "A", "Alice", 10001, ("Alice", "Bob", "Charlie")),
            Expense("2", "B", "Bob", 7777, ("Bob", "Charlie")),
            Expense("3", "C", "Charlie", 3333, ("Alice", "Charlie"), (2, 1)),
        ]
        trip = make_trip(expenses)
        bal = compute_balances(trip)
        assert sum(bal.values()) == 0
