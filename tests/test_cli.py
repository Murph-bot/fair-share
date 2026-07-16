"""Tests for cli.py — argparse CLI."""

import json

import pytest

from fairshare.cli import main


@pytest.fixture
def trip_file(tmp_path):
    return tmp_path / "test.json"


def run(*args, trip_file=None, expect_success=True):
    """Helper: call main() with given args plus --file pointing to tmp file."""
    cmd = list(args)
    if trip_file is not None:
        cmd = ["--file", str(trip_file)] + cmd
    code = main(cmd)
    if expect_success:
        assert code == 0, f"Expected exit 0, got {code}"
    return code


class TestInit:
    def test_creates_file(self, trip_file):
        run("init", "Beach Trip", trip_file=trip_file)
        assert trip_file.exists()

    def test_file_contains_name(self, trip_file):
        run("init", "Beach Trip", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert data["name"] == "Beach Trip"

    def test_overwrites_existing(self, trip_file):
        run("init", "Trip1", trip_file=trip_file)
        run("init", "Trip2", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert data["name"] == "Trip2"


class TestAddPerson:
    def test_add_single_person(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert "Alice" in data["people"]

    def test_add_multiple_people(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", "Charlie", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert "Alice" in data["people"]
        assert "Bob" in data["people"]
        assert "Charlie" in data["people"]

    def test_duplicate_person_ignored(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", trip_file=trip_file)
        run("add-person", "Alice", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert data["people"].count("Alice") == 1

    def test_case_insensitive_dedup(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "alice", trip_file=trip_file)
        run("add-person", "ALICE", trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert len([p for p in data["people"] if p.lower() == "alice"]) == 1

    def test_no_file_raises_error(self, trip_file):
        code = run("add-person", "Alice", trip_file=trip_file, expect_success=False)
        assert code != 0


class TestAddExpense:
    def setup_trip(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", "Charlie", trip_file=trip_file)

    def test_basic_add(self, trip_file):
        self.setup_trip(trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "60", "--with", "Alice,Bob,Charlie",
              trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert len(data["expenses"]) == 1
        assert data["expenses"][0]["description"] == "Dinner"
        assert data["expenses"][0]["amount_cents"] == 6000

    def test_dollar_sign_amount(self, trip_file):
        self.setup_trip(trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "$60", "--with", "Alice,Bob,Charlie",
              trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert data["expenses"][0]["amount_cents"] == 6000

    def test_decimal_amount(self, trip_file):
        self.setup_trip(trip_file)
        run("add", "Coffee", "--payer", "Bob", "--amount", "9.99", "--with", "Alice,Bob",
              trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert data["expenses"][0]["amount_cents"] == 999

    def test_weighted_split(self, trip_file):
        self.setup_trip(trip_file)
        run(
            "add", "Hotel",
            "--payer", "Alice",
            "--amount", "90",
            "--with", "Alice,Bob,Charlie",
            "--weights", "Alice=2,Bob=1,Charlie=1",
            trip_file=trip_file,
        )
        data = json.loads(trip_file.read_text())
        exp = data["expenses"][0]
        assert exp["weights"] == [2, 1, 1]

    def test_unknown_payer_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "X", "--payer", "Zara", "--amount", "10", "--with", "Alice",
            trip_file=trip_file, expect_success=False,
        )
        assert code != 0

    def test_unknown_participant_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "X", "--payer", "Alice", "--amount", "10", "--with", "Alice,Zara",
            trip_file=trip_file, expect_success=False,
        )
        assert code != 0

    def test_empty_participants_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "X", "--payer", "Alice", "--amount", "10", "--with", "",
            trip_file=trip_file, expect_success=False,
        )
        assert code != 0

    def test_negative_amount_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "X", "--payer", "Alice", "--amount", "-10", "--with", "Alice",
            trip_file=trip_file, expect_success=False,
        )
        assert code != 0

    def test_duplicate_participants_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "X", "--payer", "Alice", "--amount", "10", "--with", "Alice,Alice",
            trip_file=trip_file, expect_success=False,
        )
        assert code != 0

    def test_weights_missing_participant_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "Hotel",
            "--payer", "Alice",
            "--amount", "90",
            "--with", "Alice,Bob,Charlie",
            "--weights", "Alice=2,Bob=1",
            trip_file=trip_file,
            expect_success=False,
        )
        assert code != 0

    def test_weights_extra_person_fails(self, trip_file):
        self.setup_trip(trip_file)
        code = run(
            "add", "Hotel",
            "--payer", "Alice",
            "--amount", "90",
            "--with", "Alice,Bob",
            "--weights", "Alice=2,Bob=1,Charlie=1",
            trip_file=trip_file,
            expect_success=False,
        )
        assert code != 0

    def test_expense_id_is_full_uuid(self, trip_file):
        self.setup_trip(trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "60", "--with", "Alice,Bob",
              trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        assert len(data["expenses"][0]["id"]) == 36


class TestInitValidation:
    def test_empty_trip_name_fails(self, trip_file):
        code = run("init", "   ", trip_file=trip_file, expect_success=False)
        assert code != 0


class TestList:
    def test_list_empty(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("list", trip_file=trip_file)
        out = capsys.readouterr().out
        assert "no expenses" in out.lower() or out.strip() == "" or "0" in out

    def test_list_shows_expense(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", trip_file=trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "60", "--with", "Alice,Bob",
              trip_file=trip_file)
        run("list", trip_file=trip_file)
        out = capsys.readouterr().out
        assert "Dinner" in out
        assert "Alice" in out


class TestBalances:
    def test_balances_output(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", trip_file=trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "60", "--with", "Alice,Bob",
              trip_file=trip_file)
        run("balances", trip_file=trip_file)
        out = capsys.readouterr().out
        assert "Alice" in out
        assert "Bob" in out

    def test_no_expenses_balances(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", trip_file=trip_file)
        run("balances", trip_file=trip_file)
        out = capsys.readouterr().out
        assert out is not None


class TestSettle:
    def test_settle_output(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", trip_file=trip_file)
        run("add", "Dinner", "--payer", "Alice", "--amount", "60", "--with", "Alice,Bob",
              trip_file=trip_file)
        run("settle", trip_file=trip_file)
        out = capsys.readouterr().out
        assert "Bob" in out
        assert "Alice" in out

    def test_settle_no_debts(self, trip_file, capsys):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", trip_file=trip_file)
        run("settle", trip_file=trip_file)
        out = capsys.readouterr().out
        assert "settled" in out.lower() or "no" in out.lower() or out.strip() == ""


class TestRemoveExpense:
    def test_remove_by_id(self, trip_file):
        run("init", "T", trip_file=trip_file)
        run("add-person", "Alice", "Bob", trip_file=trip_file)
        run("add", "D", "--payer", "Alice", "--amount", "10", "--with", "Alice,Bob",
              trip_file=trip_file)
        data = json.loads(trip_file.read_text())
        expense_id = data["expenses"][0]["id"]
        run("remove-expense", expense_id, trip_file=trip_file)
        data2 = json.loads(trip_file.read_text())
        assert len(data2["expenses"]) == 0

    def test_remove_nonexistent_fails(self, trip_file):
        run("init", "T", trip_file=trip_file)
        code = run("remove-expense", "nonexistent", trip_file=trip_file, expect_success=False)
        assert code != 0


class TestNoFileError:
    def test_missing_file_on_command_returns_error(self, tmp_path):
        missing = tmp_path / "missing.json"
        code = run("list", trip_file=missing, expect_success=False)
        assert code != 0
