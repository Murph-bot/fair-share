"""JSON persistence with atomic writes and schema versioning."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from fairshare.errors import StorageError, ValidationError
from fairshare.models import Trip

SCHEMA_VERSION = 1


def load(path: Path) -> Trip:
    """Load a :class:`Trip` from *path*.

    Raises :class:`StorageError` if the file is missing, unreadable, or corrupt.
    """
    if not path.exists():
        raise StorageError(f"File not found: {path}")

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise StorageError(f"Cannot read {path}: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StorageError(f"Corrupt JSON in {path}: {exc}") from exc

    if "schema_version" not in data:
        raise StorageError(f"Missing schema_version in {path}")

    if data["schema_version"] != SCHEMA_VERSION:
        raise StorageError(
            f"Unsupported schema version {data['schema_version']} in {path}. "
            f"Expected {SCHEMA_VERSION}."
        )

    try:
        return Trip.from_dict(data)
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        raise StorageError(f"Invalid data in {path}: {exc}") from exc


def save(trip: Trip, path: Path) -> None:
    """Atomically write *trip* as JSON to *path* (temp file + rename)."""
    data = trip.to_dict()
    json_text = json.dumps(data, indent=2, ensure_ascii=False)

    # Write to a temp file in the same directory, then atomically rename
    dir_ = path.parent
    dir_.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json_text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except OSError as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise StorageError(f"Failed to write {path}: {exc}") from exc
