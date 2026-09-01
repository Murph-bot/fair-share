"""Tests for storage.py — JSON persistence."""

import json

import pytest

from fairshare.errors import StorageError
from fairshare.models import Expense, Trip
from fairshare.storage import load, save


@pytest.fixture
def tmp_path_file(tmp_path):
    return tmp_path / "fairshare.json"


def sample_trip():
    return Trip(
        name="Beach Trip",
        people=("Alice", "Bob"),
        expenses=(
            Expense(
                id="abc123",
                description="Dinner",
                payer="Alice",
                amount_cents=6000,
                participants=("Alice", "Bob"),
            ),
        ),
    )


class TestSave:
    def test_creates_file(self, tmp_path_file):
        trip = Trip(name="Test", people=("Alice",))
        save(trip, tmp_path_file)
        assert tmp_path_file.exists()

    def test_file_is_valid_json(self, tmp_path_file):
        save(sample_trip(), tmp_path_file)
        data = json.loads(tmp_path_file.read_text())
        assert "name" in data

    def test_schema_version_present(self, tmp_path_file):
        save(sample_trip(), tmp_path_file)
        data = json.loads(tmp_path_file.read_text())
        assert data.get("schema_version") == 1

    def test_roundtrip(self, tmp_path_file):
        original = sample_trip()
        save(original, tmp_path_file)
        loaded = load(tmp_path_file)
        assert loaded.name == original.name
        assert loaded.people == original.people
        assert len(loaded.expenses) == 1
        assert loaded.expenses[0].id == "abc123"
        assert loaded.expenses[0].amount_cents == 6000

    def test_roundtrip_weighted_expense(self, tmp_path_file):
        trip = Trip(
            name="Hotel",
            people=("Alice", "Bob", "Charlie"),
            expenses=(
                Expense(
                    id="w1",
                    description="Hotel",
                    payer="Alice",
                    amount_cents=9000,
                    participants=("Alice", "Bob", "Charlie"),
                    weights=(2, 1, 1),
                ),
            ),
        )
        save(trip, tmp_path_file)
        loaded = load(tmp_path_file)
        assert loaded.expenses[0].weights == (2, 1, 1)


class TestLoad:
    def test_missing_file_raises(self, tmp_path_file):
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_corrupt_json_raises(self, tmp_path_file):
        tmp_path_file.write_text("{not valid json")
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_missing_schema_version_raises(self, tmp_path_file):
        tmp_path_file.write_text(json.dumps({"name": "trip", "people": []}))
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_wrong_schema_version_raises(self, tmp_path_file):
        payload = {
            "name": "trip",
            "people": [],
            "schema_version": 99,
            "expenses": [],
        }
        tmp_path_file.write_text(json.dumps(payload))
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_atomic_write_does_not_corrupt_on_partial(self, tmp_path_file):
        trip = sample_trip()
        save(trip, tmp_path_file)
        save(Trip(name="Updated", people=("Bob",)), tmp_path_file)
        loaded = load(tmp_path_file)
        assert loaded.name == "Updated"

    def test_invalid_trip_data_raises(self, tmp_path_file):
        """from_dict with missing required keys raises StorageError."""
        bad = {"schema_version": 1, "expenses": [{"id": "x"}]}
        tmp_path_file.write_text(json.dumps(bad))
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_unreadable_file_raises(self, tmp_path_file, monkeypatch):
        """OSError during read_text raises StorageError."""
        tmp_path_file.write_text('{"schema_version":1}')

        def _bad_read(*args, **kwargs):
            raise OSError("permission denied")

        monkeypatch.setattr(tmp_path_file.__class__, "read_text", _bad_read)
        with pytest.raises(StorageError, match="Cannot read"):
            load(tmp_path_file)

    def test_write_failure_raises_storage_error(self, tmp_path_file, monkeypatch):
        """OSError during atomic rename is wrapped as StorageError."""

        def _bad_replace(src, dst):
            raise OSError("disk full")

        monkeypatch.setattr("fairshare.storage.os.replace", _bad_replace)
        with pytest.raises(StorageError, match="Failed to write"):
            save(sample_trip(), tmp_path_file)

    def test_mismatched_weights_in_file_raise(self, tmp_path_file):
        payload = {
            "schema_version": 1,
            "name": "trip",
            "people": ["Alice", "Bob"],
            "expenses": [
                {
                    "id": "x",
                    "description": "Hotel",
                    "payer": "Alice",
                    "amount_cents": 9000,
                    "participants": ["Alice", "Bob"],
                    "weights": [2, 1, 1],
                }
            ],
        }
        tmp_path_file.write_text(json.dumps(payload))
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_empty_participants_in_file_raise(self, tmp_path_file):
        payload = {
            "schema_version": 1,
            "name": "trip",
            "people": ["Alice"],
            "expenses": [
                {
                    "id": "x",
                    "description": "Ghost",
                    "payer": "Alice",
                    "amount_cents": 100,
                    "participants": [],
                }
            ],
        }
        tmp_path_file.write_text(json.dumps(payload))
        with pytest.raises(StorageError):
            load(tmp_path_file)

    def test_non_positive_amount_in_file_raise(self, tmp_path_file):
        payload = {
            "schema_version": 1,
            "name": "trip",
            "people": ["Alice"],
            "expenses": [
                {
                    "id": "x",
                    "description": "Zero",
                    "payer": "Alice",
                    "amount_cents": 0,
                    "participants": ["Alice"],
                }
            ],
        }
        tmp_path_file.write_text(json.dumps(payload))
        with pytest.raises(StorageError):
            load(tmp_path_file)
