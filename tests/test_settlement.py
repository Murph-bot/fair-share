"""Tests for settlement.py — greedy min-cash-flow."""

import pytest

from fairshare.settlement import Payment, settle


class TestSettle:
    def test_simple_two_person(self):
        # Bob owes Alice $10
        payments = settle({"Alice": 1000, "Bob": -1000})
        assert len(payments) == 1
        p = payments[0]
        assert p.frm == "Bob"
        assert p.to == "Alice"
        assert p.amount_cents == 1000

    def test_three_person_chain(self):
        # Alice +60, Bob -30, Charlie -30
        payments = settle({"Alice": 6000, "Bob": -3000, "Charlie": -3000})
        total_paid = sum(p.amount_cents for p in payments)
        assert total_paid == 6000
        # Each payment settles exactly one debt
        for p in payments:
            assert p.amount_cents > 0

    def test_balanced_balances_returns_empty(self):
        assert settle({"Alice": 0, "Bob": 0}) == []

    def test_empty_balances(self):
        assert settle({}) == []

    def test_single_positive_only(self):
        # Degenerate: only credits, no debits → nothing to settle
        assert settle({"Alice": 1000}) == []

    def test_payments_sum_correct(self):
        balances = {"Alice": 5000, "Bob": -2000, "Charlie": -3000}
        payments = settle(balances)
        # Total sent == total received
        total_out = sum(p.amount_cents for p in payments)
        assert total_out == 5000

    def test_no_self_payments(self):
        payments = settle({"Alice": 1000, "Bob": -1000})
        for p in payments:
            assert p.frm != p.to

    def test_all_positive_amounts(self):
        payments = settle({"Alice": 3000, "Bob": -1000, "Charlie": -2000})
        for p in payments:
            assert p.amount_cents > 0

    def test_complex_scenario(self):
        # 4 people
        balances = {"Alice": 10000, "Bob": -3000, "Charlie": -4000, "Dave": -3000}
        payments = settle(balances)
        # Verify: for each person, original_balance + cash_flow == 0
        # Debtors pay (+cash_flow covers negative balance)
        # Creditors receive (-cash_flow covers positive balance)
        cash = {}
        for p in payments:
            cash[p.frm] = cash.get(p.frm, 0) + p.amount_cents  # payer's debt shrinks
            cash[p.to] = cash.get(p.to, 0) - p.amount_cents  # receiver's credit shrinks
        for person, original in balances.items():
            settled = original + cash.get(person, 0)
            assert settled == 0, f"{person} not fully settled: {settled}"

    def test_payment_is_frozen(self):
        p = Payment(frm="Bob", to="Alice", amount_cents=500)
        with pytest.raises(Exception):
            p.amount_cents = 999  # type: ignore[misc]
