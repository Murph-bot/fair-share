"""Immutable frozen dataclasses for the fair-share domain."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fairshare.errors import ValidationError


@dataclass(frozen=True)
class Expense:
    """A single shared expense."""

    id: str
    description: str
    payer: str
    amount_cents: int
    participants: tuple[str, ...]
    weights: tuple[int, ...] | None = None
    date: str | None = None
    category: str | None = None
    note: str | None = None
    currency: str | None = None
    exchange_rate: str | None = None
    tax_cents: int | None = None
    tip_cents: int | None = None

    def __post_init__(self) -> None:
        if self.amount_cents <= 0:
            raise ValidationError(f"amount_cents must be positive, got {self.amount_cents}")
        if not self.participants:
            raise ValidationError("participants must not be empty")
        if self.weights is not None:
            if len(self.weights) != len(self.participants):
                raise ValidationError(
                    f"weights length ({len(self.weights)}) must match "
                    f"participants ({len(self.participants)})"
                )
            if any(w <= 0 for w in self.weights):
                raise ValidationError(f"All weights must be positive, got {self.weights}")
        for name, value in (("tax_cents", self.tax_cents), ("tip_cents", self.tip_cents)):
            if value is not None and value < 0:
                raise ValidationError(f"{name} must be non-negative, got {value}")

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "description": self.description,
            "payer": self.payer,
            "amount_cents": self.amount_cents,
            "participants": list(self.participants),
        }
        optional = (
            ("weights", self.weights, list),
            ("date", self.date, str),
            ("category", self.category, str),
            ("note", self.note, str),
            ("currency", self.currency, str),
            ("exchange_rate", self.exchange_rate, str),
            ("tax_cents", self.tax_cents, int),
            ("tip_cents", self.tip_cents, int),
        )
        for key, value, _conv in optional:
            if value is not None:
                d[key] = value
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Expense:
        weights_raw = data.get("weights")
        weights = tuple(int(w) for w in weights_raw) if weights_raw is not None else None
        return cls(
            id=data["id"],
            description=data["description"],
            payer=data["payer"],
            amount_cents=int(data["amount_cents"]),
            participants=tuple(data["participants"]),
            weights=weights,
            date=_optional_str(data, "date"),
            category=_optional_str(data, "category"),
            note=_optional_str(data, "note"),
            currency=_optional_str(data, "currency"),
            exchange_rate=_optional_str(data, "exchange_rate"),
            tax_cents=_optional_int(data, "tax_cents"),
            tip_cents=_optional_int(data, "tip_cents"),
        )


def _optional_str(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    return str(value) if value is not None else None


def _optional_int(data: dict[str, Any], key: str) -> int | None:
    value = data.get(key)
    return int(value) if value is not None else None


@dataclass(frozen=True)
class Trip:
    """Top-level container holding all people and expenses for a trip."""

    name: str
    people: tuple[str, ...] = field(default_factory=tuple)
    expenses: tuple[Expense, ...] = field(default_factory=tuple)
    schema_version: int = 1
    currency: str | None = None
    completed_payments: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    archived_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": self.schema_version,
            "name": self.name,
            "people": list(self.people),
            "expenses": [e.to_dict() for e in self.expenses],
        }
        if self.currency is not None:
            d["currency"] = self.currency
        if self.completed_payments:
            d["completedPayments"] = [dict(p) for p in self.completed_payments]
        if self.archived_at is not None:
            d["archivedAt"] = self.archived_at
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Trip:
        expenses = tuple(Expense.from_dict(e) for e in data.get("expenses", []))
        completed = data.get("completedPayments", [])
        if not isinstance(completed, list):
            raise ValidationError("completedPayments must be a list")
        completed_payments = tuple(
            dict(item) for item in completed if isinstance(item, dict)
        )
        return cls(
            name=data["name"],
            people=tuple(data.get("people", [])),
            expenses=expenses,
            schema_version=int(data.get("schema_version", 1)),
            currency=_optional_str(data, "currency"),
            completed_payments=completed_payments,
            archived_at=_optional_str(data, "archivedAt"),
        )
