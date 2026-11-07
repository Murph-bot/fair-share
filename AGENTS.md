# Fair Share — working notes

Split-trip-expenses app for friends and family. Web/PWA on Cloudflare Pages,
Expo mobile app, shared domain package, Python CLI/tests.

## Layout

- `pages/` — Cloudflare Pages advanced-mode worker (`_worker.ts`) + Functions
- `web/` — PWA source (Vite); `web/public/sw.js` is the service worker
- `mobile/` — Expo app (read `mobile/AGENTS.md` — Expo 57, check versioned docs)
- `packages/domain/` — shared TS domain (trip math, PIN/session crypto, i18n)
- `cron-worker/` — daily photo-expiry Worker hitting `/api/admin/expire-photos`
- `db/schema.sql` — D1 schema

## Commands

- Web tests: `cd web && npm test` (vitest)
- Mobile tests: `cd mobile && npx vitest run`
- Mobile typecheck: `cd mobile && npx tsc --noEmit`
- Pages+cron typecheck: `npm run typecheck:pages`
- Python: `python3 -m pytest` / `python3 -m ruff check .`
- Local dev: `npm run dev` (builds pages bundle, runs `wrangler pages dev` with
  local D1/R2/KV emulators from `wrangler.jsonc` — do NOT pass `--d1/--r2/--kv`
  flags; they create empty ephemeral bindings and the schema is missing)

## Deploy

- `npm run deploy` (runs `build:pages`, checks `web/dist/_worker.js`, then `wrangler pages deploy web/dist --project-name fair-share-trips`)
- **Never** run a bare `vite build` / `npm run build` before deploying: it
  rebuilds `web/dist` without `_worker.js` and the API 405s in production
  (has happened twice).
- Secrets live in Cloudflare (`PHOTO_PIN_PEPPER`, `CRON_SECRET` on both Pages
  and the cron worker) and local `.dev.vars` (gitignored).
- `pithelo.com/fairshare` forwards to this app (`apps/web/src/fairshare/proxy.ts`
  in `Murph-bot/pithelo`), which rewrites `<base href="/">` in `web/index.html`.
  Keep that tag exact, and write client URLs relative to it (`api/trips`, not
  `/api/trips`). `web/tests/paths.test.ts` fails on root-absolute ones.

## Product invariants

- No accounts, ads, analytics, monetization. Link-authorized trips.
- Photos = independent Moments gallery; never attached to expenses.
- JPEG-only uploads; originals kept at full resolution.
- Trips: link grants full edit. Photos: 6-digit PIN → session token →
  signed URLs for locked trips.
