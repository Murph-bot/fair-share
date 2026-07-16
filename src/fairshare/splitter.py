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

    Each share[i] = floor(amount_cents * weights[i] / total_weight).
    Remaining cents are distributed to the participants with the largest fractional parts.

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
    # Exact fractional shares in cents (as floats for remainder calculation)
    exact = [amount_cents * w / total_weight for w in weights]
    floors = [int(e) for e in exact]
    remainders = [e - f for e, f in zip(exact, floors)]
    leftover = amount_cents - sum(floors)

    # Distribute leftover cents to those with highest fractional part (Hamilton method)
    order = sorted(range(len(weights)), key=lambda i: remainders[i], reverse=True)
    for i in range(leftover):
        floors[order[i]] += 1

    return floors
