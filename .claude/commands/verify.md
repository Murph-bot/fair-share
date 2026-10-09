---
description: Run the Fair Share gate across Python, Pages worker, web and mobile
allowed-tools: Bash(python3 -m *), Bash(npm run typecheck:pages), Bash(npm test*), Bash(cd web*), Bash(cd mobile*), Bash(npx vitest *), Bash(npx tsc *)
---
Run in order and report each result; stop at the first failure:

1. `python3 -m ruff check .`
2. `python3 -m pytest`
3. `npm run typecheck:pages`
4. `cd web && npm test`
5. `cd mobile && npx vitest run`
6. `cd mobile && npx tsc --noEmit`

Do NOT run a bare `vite build` or `npm run build` before a deploy; use `npm run build:pages`
(see AGENTS.md: it has broken production twice).
