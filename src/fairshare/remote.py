"""HTTP import/export between a local trip file and a hosted Fair Share API."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fairshare.errors import StorageError, ValidationError
from fairshare.models import Trip
from fairshare.storage import save

TRIP_ID_RE = re.compile(r"^[a-f0-9]{32}$")


def normalize_host(host: str) -> str:
    trimmed = host.strip().rstrip("/")
    if not trimmed:
        raise ValidationError(
            "Pass --host or set FAIRSHARE_API (e.g. https://fair-share-trips.netlify.app)"
        )
    return trimmed


def resolve_host(explicit: str | None, env_host: str | None) -> str:
    return normalize_host(explicit or env_host or "")


def request_json(method: str, url: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data: bytes | None = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            status = int(resp.getcode() or 0)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        parsed: Any
        try:
            parsed = json.loads(body) if body else {"error": str(exc.reason)}
        except json.JSONDecodeError:
            parsed = {"error": body or str(exc.reason)}
        return int(exc.code), parsed
    except urllib.error.URLError as exc:
        raise StorageError(f"Could not reach {url}: {exc.reason}") from exc

    if not raw:
        return status, None
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StorageError(f"Host returned invalid JSON: {exc}") from exc


def _api_error(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        message = body.get("error")
        if isinstance(message, str) and message.strip():
            return message
    return fallback


def trip_from_remote_json(data: object) -> Trip:
    if not isinstance(data, dict):
        raise ValidationError("Hosted trip must be a JSON object")
    money = {
        "schema_version": data.get("schema_version"),
        "name": data.get("name"),
        "people": data.get("people", []),
        "expenses": data.get("expenses", []),
    }
    if money["schema_version"] != 1:
        raise ValidationError(
            f"Unsupported schema version {money['schema_version']}. Expected 1."
        )
    try:
        return Trip.from_dict(money)
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        raise ValidationError(f"Invalid hosted trip: {exc}") from exc


def pull_trip(trip_id: str, host: str, dest: Path) -> Trip:
    tid = trip_id.strip().lower()
    if not TRIP_ID_RE.match(tid):
        raise ValidationError("Trip id must be 32 hexadecimal characters")
    base = normalize_host(host)
    status, body = request_json("GET", f"{base}/api/trips/{tid}")
    if status != 200:
        raise ValidationError(_api_error(body, f"Could not pull trip ({status})"))
    trip = trip_from_remote_json(body)
    save(trip, dest)
    return trip


def push_trip(trip: Trip, host: str) -> dict[str, str]:
    base = normalize_host(host)
    status, created = request_json("POST", f"{base}/api/trips", {"name": trip.name})
    if status not in {200, 201} or not isinstance(created, dict):
        raise ValidationError(_api_error(created, f"Could not create hosted trip ({status})"))
    trip_id = created.get("id")
    pin = created.get("pin")
    if not isinstance(trip_id, str) or not TRIP_ID_RE.match(trip_id):
        raise ValidationError("Host did not return a trip id")
    if not isinstance(pin, str) or not pin:
        raise ValidationError("Host did not return a photos PIN")
    payload = trip.to_dict()
    status, saved = request_json("PUT", f"{base}/api/trips/{trip_id}", payload)
    if status != 200:
        raise ValidationError(_api_error(saved, f"Could not upload expenses ({status})"))
    return {"id": trip_id, "pin": pin, "url": f"{base}/t/{trip_id}"}
