"""Immutable frozen dataclasses for the fair-share domain."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Expense:
    """A single shared expense."""

    id: str
    description: str
    payer: str
    amount_cents: int
    participants: tuple[str, ...]
    weights: tuple[int, ...] | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id": self.id,
            "description": self.description,
            "payer": self.payer,
            "amount_cents": self.amount_cents,
            "participants": list(self.participants),
        }
        if self.weights is not None:
            d["weights"] = list(self.weights)
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
        )


@dataclass(frozen=True)
class Trip:
    """Top-level container holding all people and expenses for a trip."""

    name: str
    people: tuple[str, ...] = field(default_factory=tuple)
    expenses: tuple[Expense, ...] = field(default_factory=tuple)
    schema_version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "name": self.name,
            "people": list(self.people),
            "expenses": [e.to_dict() for e in self.expenses],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Trip:
        expenses = tuple(Expense.from_dict(e) for e in data.get("expenses", []))
        return cls(
            name=data["name"],
            people=tuple(data.get("people", [])),
            expenses=expenses,
            schema_version=int(data.get("schema_version", 1)),
        )
