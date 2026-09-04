# fair-share

A Python CLI tool for splitting expenses fairly among a group of people.

**Overview PDF:** [Fair-Share.pdf](Fair-Share.pdf) — architecture, algorithms, and what the CLI, website, and mobile app can do. Source: [`docs/fair-share.tex`](docs/fair-share.tex).

## Features

- Integer-cent arithmetic (never floats) for exact splits
- Equal split with deterministic remainder distribution
- Weighted split using integer Hamilton / largest-remainder (no floats)
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
# Start a new trip (refuses to overwrite an existing file unless --force)
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

# Remove an expense by full ID or unique prefix
fairshare remove-expense <id>

# Edit an expense by full ID or unique prefix (same flags as add).
# Omit --weights to store an equal split.
fairshare edit-expense <id> "Lunch" --payer Bob --amount 20 --with Alice,Bob

# Download a hosted trip (money only — no photos, no PIN hash)
fairshare pull --id <32-hex-id> --host https://fair-share-trips.netlify.app

# Upload this file as a new hosted trip (prints a new link and PIN)
fairshare push --host https://fair-share-trips.netlify.app

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
- **Weighted split**: Integer Hamilton (largest-remainder). Each share is `amount * weight // total_weight`; leftover cents go to the largest remainders.

### Settlement algorithm

Uses a greedy min-cash-flow heuristic: repeatedly pairs the largest debtor with the largest creditor until all balances are settled. This is **not** guaranteed to be globally optimal (that problem is NP-hard), but it produces a small number of transactions in practice.

## Web app

A cream/brown PWA (euro, shared trip links) lives in `web/` and deploys to Netlify.

```bash
npm ci
npm --prefix web ci
npx netlify dev
```

Open http://localhost:8888 — create a trip, then share `/t/<id>`. Anyone with the link can edit expenses. Photos use a 6-digit PIN shown on the trip page (Copy PIN).

**Download JSON** on a trip page saves people and expenses only. **Open JSON** on the home page creates a *new* hosted trip from that file (new id and PIN). Photos are never in the file.

You can also use `fairshare pull` / `fairshare push` with `--host` or `FAIRSHARE_API`. `push` always creates a new hosted trip.

Set `PHOTO_PIN_PEPPER` in `.env` (see `.env.example`) for local functions, and the same key in the Netlify UI for production. Without it, creating a trip fails.

Photos are stored in Netlify Blobs, compressed on the device, and removed automatically after a year. Optional full-resolution originals go to Cloudinary (authenticated assets, signed download URLs). Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env` and the Netlify UI. If those are missing, gallery uploads still work and `originalUrl` stays empty.

## Mobile app

An Expo client lives in `mobile/` (iOS, Android, and a web preview). It uses the same trip and photo HTTP API. Store binaries are built with EAS; the repo does not contain ejected `ios/` or `android/` projects. See [mobile/README.md](mobile/README.md).

```bash
npm --prefix mobile ci
npm --prefix mobile test
npm --prefix mobile run typecheck
```

```bash
npm --prefix web test
npm --prefix web run build
```

## Development (CLI)

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
