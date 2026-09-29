# Fair-Share Debugging & Fix Prompt Guide

Use this prompt when asking an AI model to debug issues in the Fair-Share codebase.

## Recommended Prompt Template

```text
I'm debugging an issue in the Fair-Share repo.

Project context:
- Monorepo / multi-app setup
- Web app: Vite + TypeScript + likely a frontend client
- Mobile app: Expo / React Native
- Shared logic package: internal domain utilities or business logic
- Infra: Cloudflare Pages / Workerd / D1 / R2 / KV (if relevant)
- CLI / Python tooling may be involved for calculations or scripts

Problem:
[Describe exactly what is broken, including expected vs actual behavior]

Steps to reproduce:
1. [Step 1]
2. [Step 2]
3. [Step 3]

Error or symptom:
[Paste the exact error, stack trace, UI issue, or wrong output]

Relevant files:
- [path/to/file1.ts]
- [path/to/file2.ts]
- [path/to/file3.py]

Recent context:
- Changed recently: [brief description]
- Environment: [local dev / preview / production / test]
- Related services or infra: [D1 / KV / R2 / worker / mobile app / CLI]

What I've already tried:
1. [Attempt 1]
2. [Attempt 2]
3. [Attempt 3]

What I need from you:
1. Find the root cause
2. Explain why this happens
3. Suggest the minimal safe fix
4. Provide code changes or patch snippets
5. Include tests or validation steps
6. Call out any edge cases or pitfalls

Please be precise and keep the fix aligned with the existing architecture of Fair-Share.
```

---

## Stronger Variant for Complex Bugs

```text
Debug this issue in the Fair-Share codebase.

Goal:
- Identify the root cause
- Fix the bug with the smallest safe patch
- Keep compatibility with the existing app architecture

Repo structure context:
- web app
- shared domain logic
- mobile app
- cloud / storage / edge worker code if applicable
- CLI and/or Python scripts

Bug description:
[Explain exactly what is failing]

Expected behavior:
[Describe the correct behavior]

Actual behavior:
[Describe what is happening now]

Reproduction:
[Paste the exact steps or sample input]

Relevant evidence:
- Error output:
[Paste stack trace or error]
- Logs:
[Paste relevant logs]
- Data examples:
[Paste example values or payloads]

Constraints:
- Preserve current business rules and data model
- Avoid broad refactors unless required
- Prefer minimal changes with clear validation
- Do not assume the app is a single frontend; respect the multi-package setup

Please:
1. Trace the execution path to the likely failing component
2. Explain the root cause in plain English
3. Recommend the exact fix
4. Show the relevant code diff or pseudocode
5. Suggest at least one test case that would catch this regression
```

---

## Template for Review/Architecture Problems

```text
Please review this Fair-Share change for correctness, maintainability, and risk.

What changed:
[Short summary of feature or fix]

Files involved:
- [path/to/file1.ts]
- [path/to/file2.ts]

Context:
- Stack: [Vite / React / Expo / TypeScript / Cloudflare / Python]
- Domain: [expenses, settlement logic, storage, auth, etc.]
- Environment: [local / preview / production]

What I need:
1. Look for logic bugs or edge cases
2. Flag any security or data integrity issues
3. Check whether this matches the project patterns
4. Suggest improvements with examples
5. Highlight any hidden risks in sync/storage/calculation flows

Please be conservative and explain tradeoffs.
```

---

## Example Prompt for Fair-Share

```text
I'm debugging a bug in Fair-Share.

Project context:
- TypeScript-based app
- Expense sharing logic with settlement calculations
- possible shared business logic and multiple client surfaces
- Cloudflare-backed infra may be involved

Problem:
The settlement values are off by a small amount when users split expenses with rounded cents.

Expected behavior:
Each person should receive the exact correct amount after all expenses and reimbursements are settled.

Actual behavior:
Some participants are one cent over or under due to rounding differences in the algorithm.

Steps to reproduce:
1. Add a set of expenses with amounts that do not divide evenly
2. Trigger the settlement calculation
3. Review the generated amounts from the app or CLI

Relevant files:
- src/utils/settlement.ts
- src/domain/expense.ts
- tests/settlement.test.ts

What I've tried:
1. Logging intermediate values
2. Checking rounding logic
3. Comparing output to expected totals

What I need:
- Root cause analysis
- Minimal code fix
- Test coverage to prevent regressions
- Any edge cases around cent-based arithmetic or greedy settlement

Please explain the bug clearly and provide the fix in TypeScript.
```

---

## Best Practices for This Repo

- Be explicit about whether the issue is in the web app, mobile app, shared logic, worker, or CLI.
- Mention whether the bug is in calculations, storage, API data flow, or UI rendering.
- Include sample inputs or exact numbers if the issue is mathematical or settlement-related.
- If the bug is in edge-worker or cloud-storage logic, mention that the environment may differ from local dev.
- Always ask for root cause, not only a patch.
- Ask for validation steps and tests, especially for money/settlement logic.

---

## Use This When You Need a Fast Prompt

```text
Debug this Fair-Share bug. Be surgical, explain the root cause, and provide a safe fix.

Issue: [describe issue]
Environment: [local / preview / prod]
Relevant files: [paths]
Expected: [expected outcome]
Actual: [actual behavior]
Repro: [steps]
Errors: [paste logs or stack trace]

Please suggest the fix, explain why it happens, and include validation steps.
```

---

## Quick Rule

If the bug affects money, fairness, settlements, or distributed storage logic, request:
- integer-safe arithmetic checks,
- edge-case analysis,
- and regression tests before accepting the fix.
