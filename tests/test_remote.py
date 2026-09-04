"""Tests for CLI ↔ hosted trip import/export (money JSON only)."""

import json
from unittest.mock import patch

import pytest

from fairshare.errors import ValidationError
from fairshare.models import Expense, Trip
from fairshare.remote import pull_trip, push_trip, trip_from_remote_json

HOST = "https://fair-share.example"


def sample_remote_body():
    return {
        "schema_version": 1,
        "name": "Athens",
        "photos_locked": True,
        "pin_hash": "should-not-leak",
        "people": ["Alice", "Bob"],
        "expenses": [
            {
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "description": "Dinner",
                "payer": "Alice",
                "amount_cents": 6000,
                "participants": ["Alice", "Bob"],
            }
        ],
    }


class TestTripFromRemoteJson:
    def test_strips_pin_and_lock_flags(self):
        trip = trip_from_remote_json(sample_remote_body())
        dumped = trip.to_dict()
        assert dumped["schema_version"] == 1
        assert dumped["name"] == "Athens"
        assert dumped["people"] == ["Alice", "Bob"]
        assert dumped["expenses"][0]["id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assert "photos_locked" not in dumped
        assert "pin_hash" not in dumped

    def test_rejects_non_object(self):
        with pytest.raises(ValidationError):
            trip_from_remote_json([])

    def test_rejects_wrong_schema_version(self):
        with pytest.raises(ValidationError, match="schema version"):
            trip_from_remote_json({"schema_version": 2, "name": "X", "people": [], "expenses": []})


class TestPullTrip:
    def test_writes_money_json_only(self, tmp_path):
        dest = tmp_path / "pulled.json"

        def fake_request(method, url, payload=None):
            assert method == "GET"
            assert url == f"{HOST}/api/trips/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            assert payload is None
            return 200, sample_remote_body()

        with patch("fairshare.remote.request_json", fake_request):
            trip = pull_trip("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", HOST, dest)

        data = json.loads(dest.read_text())
        assert data["schema_version"] == 1
        assert "photos_locked" not in data
        assert "pin_hash" not in data
        assert trip.expenses[0].id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    def test_rejects_bad_trip_id(self, tmp_path):
        with pytest.raises(ValidationError, match="32"):
            pull_trip("not-an-id", HOST, tmp_path / "x.json")

    def test_404_is_an_error(self, tmp_path):
        def fake_request(method, url, payload=None):
            return 404, {"error": "Trip not found"}

        with patch("fairshare.remote.request_json", fake_request):
            with pytest.raises(ValidationError, match="Trip not found"):
                pull_trip("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", HOST, tmp_path / "x.json")


class TestPushTrip:
    def test_creates_then_puts_preserving_expense_ids(self):
        local = Trip(
            name="Athens",
            people=("Alice", "Bob"),
            expenses=(
                Expense(
                    id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    description="Dinner",
                    payer="Alice",
                    amount_cents=6000,
                    participants=("Alice", "Bob"),
                ),
            ),
        )
        calls = []

        def fake_request(method, url, payload=None):
            calls.append((method, url, payload))
            if method == "POST":
                return 201, {
                    "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "pin": "123456",
                    "photos_token": "tok",
                    "trip": {"schema_version": 1, "name": "Athens", "people": [], "expenses": []},
                }
            return 200, {
                "schema_version": 1,
                "name": "Athens",
                "people": ["Alice", "Bob"],
                "expenses": local.to_dict()["expenses"],
            }

        with patch("fairshare.remote.request_json", fake_request):
            result = push_trip(local, HOST)

        assert result["id"] == "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        assert result["pin"] == "123456"
        assert result["url"].endswith("/t/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        assert calls[0][0] == "POST"
        assert calls[0][1] == f"{HOST}/api/trips"
        assert calls[0][2] == {"name": "Athens"}
        assert calls[1][0] == "PUT"
        assert calls[1][1] == f"{HOST}/api/trips/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        put_body = calls[1][2]
        assert put_body["expenses"][0]["id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assert "photos_locked" not in put_body
        assert "pin_hash" not in put_body
        assert "pin" not in put_body

    def test_post_failure_does_not_put(self):
        local = Trip(name="Athens", people=("Alice",))
        calls = []

        def fake_request(method, url, payload=None):
            calls.append(method)
            return 500, {"error": "create failed"}

        with patch("fairshare.remote.request_json", fake_request):
            with pytest.raises(ValidationError, match="create failed"):
                push_trip(local, HOST)
        assert calls == ["POST"]


class TestRequestJson:
    def test_http_error_returns_json_error(self, monkeypatch):
        import io
        import urllib.error

        from fairshare.remote import request_json

        def fake_urlopen(req, timeout=30):
            raise urllib.error.HTTPError(
                req.full_url,
                404,
                "Not Found",
                {},
                io.BytesIO(b'{"error":"Trip not found"}'),
            )

        monkeypatch.setattr("fairshare.remote.urllib.request.urlopen", fake_urlopen)
        status, body = request_json("GET", f"{HOST}/api/trips/x")
        assert status == 404
        assert body == {"error": "Trip not found"}

    def test_network_error_is_storage_error(self, monkeypatch):
        import urllib.error

        from fairshare.errors import StorageError
        from fairshare.remote import request_json

        def fake_urlopen(req, timeout=30):
            raise urllib.error.URLError("offline")

        monkeypatch.setattr("fairshare.remote.urllib.request.urlopen", fake_urlopen)
        with pytest.raises(StorageError, match="Could not reach"):
            request_json("GET", f"{HOST}/api/trips/x")
