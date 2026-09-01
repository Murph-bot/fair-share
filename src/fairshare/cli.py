"""CLI entry-point for fair-share (argparse-based)."""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

from fairshare import __version__
from fairshare.balances import compute_balances
from fairshare.errors import (
    ExpenseNotFoundError,
    FairShareError,
    UnknownPersonError,
    ValidationError,
)
from fairshare.models import Expense, Trip
from fairshare.money import cents_to_str, parse_amount
from fairshare.settlement import settle
from fairshare.storage import load, save

DEFAULT_FILE = Path("fairshare.json")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fairshare",
        description="Split expenses fairly among a group of people.",
    )
    parser.add_argument(
        "--file",
        metavar="PATH",
        type=Path,
        default=DEFAULT_FILE,
        help="Path to the data file (default: ./fairshare.json)",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")

    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.required = True

    # init
    p_init = sub.add_parser("init", help="Create a new trip")
    p_init.add_argument("name", help="Trip name")
    p_init.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an existing data file",
    )

    # add-person
    p_addp = sub.add_parser("add-person", help="Add one or more people to the trip")
    p_addp.add_argument("names", nargs="+", metavar="NAME", help="Person name(s)")

    # add
    p_add = sub.add_parser("add", help="Record an expense")
    p_add.add_argument("description", help="Expense description")
    p_add.add_argument("--payer", required=True, help="Who paid")
    p_add.add_argument("--amount", required=True, help="Amount (e.g. 60, 60.00, $60)")
    p_add.add_argument(
        "--with",
        dest="participants",
        required=True,
        help="Comma-separated list of participants",
    )
    p_add.add_argument(
        "--weights",
        default=None,
        help="Comma-separated name=weight pairs, e.g. Alice=2,Bob=1",
    )

    # list
    sub.add_parser("list", help="List all expenses")

    # balances
    sub.add_parser("balances", help="Show net balances")

    # settle
    sub.add_parser("settle", help="Show settlement payments")

    # remove-expense
    p_rm = sub.add_parser("remove-expense", help="Remove an expense by ID")
    p_rm.add_argument("id", help="Expense ID")

    return parser


def _normalize_name(name: str) -> str:
    return name.strip()


def _find_canonical(people: tuple[str, ...], name: str) -> str | None:
    """Return the canonical (first-seen) name for *name*, or None if unknown."""
    lower = name.strip().lower()
    for person in people:
        if person.lower() == lower:
            return person
    return None


def _require_file(path: Path) -> Trip:
    """Load trip from *path*."""
    return load(path)


def cmd_init(args: argparse.Namespace) -> int:
    name = args.name.strip()
    if not name:
        raise ValidationError("Trip name cannot be empty")
    if args.file.exists() and not args.force:
        raise ValidationError(f"File already exists: {args.file}. Use --force to overwrite.")
    trip = Trip(name=name)
    save(trip, args.file)
    print(f"Initialized trip '{trip.name}' → {args.file}")
    return 0


def cmd_add_person(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)
    people = list(trip.people)
    added = []
    for raw_name in args.names:
        name = _normalize_name(raw_name)
        if not name:
            raise ValidationError("Person name cannot be empty")
        if "," in name:
            raise ValidationError(
                "Person names cannot contain commas (they would break --with lists)."
            )
        if _find_canonical(tuple(people), name) is None:
            people.append(name)
            added.append(name)
    new_trip = Trip(
        name=trip.name,
        people=tuple(people),
        expenses=trip.expenses,
        schema_version=trip.schema_version,
    )
    save(new_trip, args.file)
    if added:
        print(f"Added: {', '.join(added)}")
    else:
        print("No new people added (all already present)")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)

    description = args.description.strip()
    if not description:
        raise ValidationError("Expense description cannot be empty")

    amount_cents = parse_amount(args.amount)

    payer_canonical = _find_canonical(trip.people, args.payer)
    if payer_canonical is None:
        raise UnknownPersonError(f"Payer '{args.payer}' not found. Add them with add-person first.")

    # Parse participants
    raw_parts = [p.strip() for p in args.participants.split(",") if p.strip()]
    if not raw_parts:
        raise ValidationError("--with must contain at least one participant")

    participants_canonical = []
    for name in raw_parts:
        canonical = _find_canonical(trip.people, name)
        if canonical is None:
            raise UnknownPersonError(
                f"Participant '{name}' not found. Add them with add-person first."
            )
        participants_canonical.append(canonical)

    if len(participants_canonical) != len(set(participants_canonical)):
        raise ValidationError("Duplicate participants in --with are not allowed")

    # Parse optional weights
    weights: tuple[int, ...] | None = None
    if args.weights:
        weight_map: dict[str, int] = {}
        for token in args.weights.split(","):
            token = token.strip()
            if "=" not in token:
                raise ValidationError(f"Invalid weight token: {token!r}. Use name=integer format.")
            k, v = token.split("=", 1)
            k = k.strip()
            canonical_k = _find_canonical(trip.people, k)
            if canonical_k is None:
                raise UnknownPersonError(f"Weight person '{k}' not found.")
            try:
                weight = int(v.strip())
            except ValueError as exc:
                raise ValidationError(f"Weight for '{k}' must be an integer, got {v!r}") from exc
            if weight <= 0:
                raise ValidationError(f"Weight for '{k}' must be a positive integer, got {weight}")
            if canonical_k in weight_map:
                raise ValidationError(f"Duplicate weight for '{canonical_k}'")
            weight_map[canonical_k] = weight

        missing = [p for p in participants_canonical if p not in weight_map]
        if missing:
            raise ValidationError(
                f"--weights must include every participant. Missing: {', '.join(missing)}"
            )
        extra = [name for name in weight_map if name not in participants_canonical]
        if extra:
            raise ValidationError(f"--weights includes people not in --with: {', '.join(extra)}")

        weights = tuple(weight_map[p] for p in participants_canonical)

    expense = Expense(
        id=str(uuid.uuid4()),
        description=description,
        payer=payer_canonical,
        amount_cents=amount_cents,
        participants=tuple(participants_canonical),
        weights=weights,
    )

    new_trip = Trip(
        name=trip.name,
        people=trip.people,
        expenses=trip.expenses + (expense,),
        schema_version=trip.schema_version,
    )
    save(new_trip, args.file)
    amount = cents_to_str(expense.amount_cents)
    print(f"Added expense '{expense.description}' ({amount}) — id: {expense.id}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)
    if not trip.expenses:
        print("No expenses recorded.")
        return 0
    print(f"{'ID':<36}  {'Description':<25} {'Payer':<12} {'Amount':>10}  Participants")
    print("-" * 100)
    for e in trip.expenses:
        parts = ", ".join(e.participants)
        amount = cents_to_str(e.amount_cents)
        print(f"{e.id:<36}  {e.description:<25} {e.payer:<12} {amount:>10}  {parts}")
    return 0


def cmd_balances(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)
    if not trip.expenses:
        print("No expenses recorded.")
        return 0
    balances = compute_balances(trip)
    print(f"{'Person':<20} {'Balance':>12}")
    print("-" * 34)
    for person in sorted(balances):
        bal = balances[person]
        sign = "+" if bal >= 0 else ""
        print(f"{person:<20} {sign}{cents_to_str(bal):>12}")
    return 0


def cmd_settle(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)
    balances = compute_balances(trip)
    payments = settle(balances)
    if not payments:
        print("All settled — no payments needed.")
        return 0
    print("Settlement payments:")
    for p in payments:
        print(f"  {p.frm} → {p.to}: {cents_to_str(p.amount_cents)}")
    return 0


def cmd_remove_expense(args: argparse.Namespace) -> int:
    trip = _require_file(args.file)
    expense_id = args.id.strip()
    if not expense_id:
        raise ValidationError("Expense ID cannot be empty")

    exact = tuple(e for e in trip.expenses if e.id == expense_id)
    if exact:
        target_id = exact[0].id
    else:
        matches = tuple(e for e in trip.expenses if e.id.startswith(expense_id))
        if not matches:
            raise ExpenseNotFoundError(f"No expense with id '{expense_id}' found.")
        if len(matches) > 1:
            ids = ", ".join(e.id for e in matches)
            raise ValidationError(f"Ambiguous expense id prefix {expense_id!r}. Matches: {ids}")
        target_id = matches[0].id

    remaining = tuple(e for e in trip.expenses if e.id != target_id)
    new_trip = Trip(
        name=trip.name,
        people=trip.people,
        expenses=remaining,
        schema_version=trip.schema_version,
    )
    save(new_trip, args.file)
    print(f"Removed expense {target_id}")
    return 0


_COMMAND_MAP = {
    "init": cmd_init,
    "add-person": cmd_add_person,
    "add": cmd_add,
    "list": cmd_list,
    "balances": cmd_balances,
    "settle": cmd_settle,
    "remove-expense": cmd_remove_expense,
}


def main(argv: list[str] | None = None) -> int:
    """Entry point. Returns exit code."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        handler = _COMMAND_MAP[args.command]
        return handler(args)
    except FairShareError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
