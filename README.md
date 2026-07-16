# fair-share

A Python CLI tool for splitting expenses fairly among a group of people.

## Features

- Integer-cent arithmetic (never floats) for exact splits
- Equal split with deterministic remainder distribution
- Weighted split using the Hamilton / largest-remainder method
- Greedy min-cash-flow settlement algorithm
- Atomic JSON persistence (temp file + rename)
- Case-insensitive person matching (canonical first-seen casing stored)

## Install

```bash
pip install -e ".[dev]"
```

Requires Python 3.11+.

## Quick Usage

```bash
# Start a new trip
fairshare init "Weekend Trip"

# Add participants
fairshare add-person Alice Bob Charlie

# Record an expense (equal split)
fairshare add "Dinner" --payer Alice --amount 60 --with Alice,Bob,Charlie

# Record an expense (weighted split)
fairshare add "Hotel" --payer Alice --amount 90 --with Alice,Bob,Charlie \
    --weights Alice=2,Bob=1,Charlie=1

# List all expenses
fairshare list

# Show net balances
fairshare balances

# Show who pays whom to settle up
fairshare settle

# Remove an expense by ID
fairshare remove-expense <id>

# Use a custom data file
fairshare --file /path/to/trip.json init "My Trip"
```

The default data file is `./fairshare.json`. Override with `--file`.

Amounts accept: `60`, `60.00`, `$60`, `$60.50`.

## Design Notes

### Integer cents

All monetary values are stored and computed as integer cents (e.g. $12.50 → 1250). This avoids floating-point rounding errors.

### Split algorithm

- **Equal split**: `base = amount // n`, remainder cents are distributed one-by-one to the first `remainder` participants — deterministic and always sums to the original amount.
- **Weighted split**: Uses the Hamilton (largest-remainder) method. Each participant's exact fractional share is floored, then remaining cents go to those with the largest fractional parts.

### Settlement algorithm

Uses a greedy min-cash-flow heuristic: repeatedly pairs the largest debtor with the largest creditor until all balances are settled. This is **not** guaranteed to be globally optimal (that problem is NP-hard), but it produces a small number of transactions in practice.

## Development

```bash
# Run tests
pytest

# Run with coverage
pytest --cov=fairshare --cov-fail-under=80

# Lint
ruff check src tests
```

## License

MIT — see [LICENSE](LICENSE).
