# 31. Baseline revalidation and executable test evidence

## Scope

This stage executes the first action in `CONTINUATION-PLAN.md`: confirm the source baseline and determine which required checks have reproducible evidence. No application source, workflow or CI configuration was changed.

## 1. Exact source baseline

**Verified against GitHub branch metadata on 2026-11-04:**

- `main` SHA: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit baseline SHA in `taxi/docs/audit/README.md`: the same value.
- Result: exact match. No source-baseline drift since the start of this audit.

The merge commit is the merge of PR #55, titled `test(e2e): handle success modal before opening driver order`.

## 2. Current automated workflow coverage

The selected-main workflow `.github/workflows/e2e.yml` contains one job only:

- Install dependencies with `npm ci`.
- Install Chromium.
- Run `npm run test:e2e` against the configured live backend.
- Upload Playwright report and `e2e-results/` artifacts with seven-day retention.

It does **not** run Jest/unit tests, TypeScript checking or a production build. Therefore a green workflow result cannot be cited as evidence for those checks.

## 3. Existing E2E evidence on the exact baseline

GitHub Actions push run **#178**, run ID `41352348603`, is attached to the exact `main` SHA above.

- Workflow/job conclusion: success.
- Playwright summary in raw job log: **19 passed, 2 flaky**, 11.0 minutes.
- First-attempt failures were retried and passed:
  - `offer-passenger-cancel` — retry passed.
  - `trip-finish` — retry passed.
- The first `trip-finish` attempt also logged cleanup failure for order `19184` because cancellation returned `wrong booking state`; the retry completed.
- Artifact upload succeeded; artifact ZIP size was 20,536,179 bytes.

This is a successful CI job with flaky scenarios, not a clean 21/21 first-attempt run. The artifact's full confidentiality review is outside this stage and remains open under Work package A and Work package C.

Existing stage 09 records run #175 as 21/21. That historical result is separate from run #178 and must not be merged into one result.

## 4. Required commands identified from package configuration

The package declares Node `24.x`. Relevant scripts/configuration:

| Check | Command | Configuration evidence |
|---|---|---|
| Unit/Jest | `npm run test:nix` | `test:nix` invokes the project test runner with `--watchAll=false` |
| TypeScript | `npx tsc --noEmit` | TypeScript is a dev dependency; `tsconfig.json` has `strict: true`, `noEmit: true`, and includes `src` |
| Production build | `npm run build:nix` | invokes `pre-build.js` then the production build script |

The build command runs `pre-build.js`. Stage 30 already established that this script can mutate tracked `src/version.json`. A clean test worktree and before/after diff capture are required so that generated version changes are not mistaken for source fixes.

Recommended controlled execution order:

1. Checkout exact SHA `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.
2. Use Node 24.x and run `npm ci`.
3. Run `npm run test:nix`; retain full output, exit code and Jest totals.
4. Run `npx tsc --noEmit`; retain full output and exit code.
5. Run `npm run build:nix`; retain full output and exit code.
6. Capture `git status --short` and diff before/after build, especially `src/version.json`.
7. Do not commit generated build/version changes.

## 5. Execution limitation and evidence status

An attempt to create a shallow checkout of the exact public GitHub repository in the available execution container failed because the container could not resolve `github.com` (DNS/network failure). The GitHub repository connector can read source, branch metadata, workflow metadata and logs, but it does not execute npm scripts.

No claim is made that Jest, TypeScript or production build passed or failed in this stage. Those three checks remain **not executed / unverified** on the exact baseline.

No new workflow was added and no CI run was triggered: the only existing workflow is E2E, and its trigger/path rules do not provide a safe way to run the three missing checks without changing CI configuration.

## 6. Findings and next action

- **BASELINE-31-01 — Baseline unchanged:** confirmed.
- **CI-31-01 — Required checks absent from current workflow:** Jest, TypeScript and production build are not enforced by the inspected E2E workflow.
- **EXEC-31-01 — Local execution unavailable:** repository checkout failed at DNS resolution; the required commands have not run.
- **E2E-31-01 — Green-with-retries is not clean stability evidence:** run #178 passed after two flaky retries; the first trip-finish attempt had a backend cleanup state conflict.

**Next action:** execute the three commands in a network-enabled, clean checkout or an approved isolated CI job against the exact SHA. Do not proceed to mark Work package A complete until raw results and the build side-effect diff are recorded.
