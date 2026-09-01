"""Split an expense amount (in cents) among participants."""

from __future__ import annotations

from fairshare.errors import ValidationError


def equal_split(amount_cents: int, n: int) -> list[int]:
    """Divide *amount_cents* equally among *n* participants.

    Uses integer division; distributes remainder cents one-by-one to the
    first ``remainder`` participants so the total always sums to *amount_cents*.

    Raises :class:`ValidationError` for non-positive amounts or n < 1.
    """
    if amount_cents <= 0:
        raise ValidationError(f"amount_cents must be positive, got {amount_cents}")
    if n < 1:
        raise ValidationError(f"n must be at least 1, got {n}")

    base = amount_cents // n
    remainder = amount_cents % n
    return [base + (1 if i < remainder else 0) for i in range(n)]


def weighted_split(amount_cents: int, weights: list[int]) -> list[int]:
    """Split *amount_cents* proportionally by *weights* (Hamilton / largest-remainder method).

    Each share uses integer division: ``amount_cents * weights[i] // total_weight``.
    Remaining cents go to the largest remainders, then original index.

    Raises :class:`ValidationError` for non-positive amounts, empty weights,
    or non-positive weights.
    """
    if amount_cents <= 0:
        raise ValidationError(f"amount_cents must be positive, got {amount_cents}")
    if not weights:
        raise ValidationError("weights must not be empty")
    if any(w <= 0 for w in weights):
        raise ValidationError(f"All weights must be positive, got {weights}")

    total_weight = sum(weights)
    floors = [amount_cents * w // total_weight for w in weights]
    remainders = [amount_cents * w % total_weight for w in weights]
    leftover = amount_cents - sum(floors)

    # Hamilton / largest-remainder: leftover cents go to highest remainder, then index
    order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
    for i in range(leftover):
        floors[order[i]] += 1

    return floors
