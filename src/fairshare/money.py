"""Money parsing and formatting utilities (all values in integer cents)."""

from __future__ import annotations

import re

from fairshare.errors import ValidationError

_AMOUNT_RE = re.compile(r"^\$?(\d+(?:\.\d{1,2})?)$")


def parse_amount(raw: str) -> int:
    """Parse a user-supplied amount string to integer cents.

    Accepts: ``60``, ``60.00``, ``$60``, ``$60.50``.
    Raises :class:`ValidationError` for anything else or for non-positive values.
    """
    m = _AMOUNT_RE.match(raw.strip())
    if not m:
        raise ValidationError(f"Invalid amount: {raw!r}. Use formats like 60, 60.00, or $60.50")

    numeric = m.group(1)
    if "." in numeric:
        integer_part, decimal_part = numeric.split(".")
        cents = int(integer_part) * 100 + int(decimal_part.ljust(2, "0"))
    else:
        cents = int(numeric) * 100

    if cents <= 0:
        raise ValidationError(f"Amount must be positive, got: {raw!r}")

    return cents


def cents_to_str(cents: int) -> str:
    """Format integer cents as a human-readable currency string, e.g. ``$12.34``."""
    if cents < 0:
        return f"-${abs(cents) // 100}.{abs(cents) % 100:02d}"
    return f"${cents // 100}.{cents % 100:02d}"
