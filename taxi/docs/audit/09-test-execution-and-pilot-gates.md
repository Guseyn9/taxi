# 09. Test execution, coverage reconciliation and pilot gates

## Scope

- Repository: `Guseyn9/taxi`
- Application baseline: `main`
- Baseline commit: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Application sources were not changed by this audit.
- This report distinguishes CI evidence from historical test notes and source-level coverage.

## 1. Test infrastructure

From `taxi/package.json` and `taxi/playwright.config.ts`:

| Layer | Command | What it establishes |
|---|---|---|
| Jest | `npm run test:nix` | Unit/component/regression tests discovered under `src` |
| Playwright | `npm run test:e2e` | Browser flows against the configured live Taxi backend |
| TypeScript | `npx tsc --noEmit` | Static type-check; not part of the package's default test script |
| Build | `npm run build:nix` | Production webpack build; separate from Jest and E2E |

Playwright runs serially (`workers: 1`, `fullyParallel: false`) because tests share live accounts and backend state. CI sets `retries: 1`; local runs default to no retry. The workflow installs dependencies with `npm ci`, installs Chromium, runs the full E2E suite, and uploads reports/artifacts with a 7-day retention.

The E2E suite uses a live backend (documented as `https://ibronevik.ru/taxi/c/gruzvill/api/v1`). It is not a mocked backend contract suite. Only map tiles are stubbed in the documented scenarios.

## 2. Verified CI evidence

### Full Playwright E2E

- Workflow: `.github/workflows/e2e.yml`
- Run: **#175**, run ID `41347130101`
- Commit tested: `b808db4a837f9e36ef13ee07595026ecc2624831` (PR #55 head)
- PR #55 base: `faffdca9f09fadcc1e61d9b62afce652e571dc0d` (already includes PR #56)
- PR #55 was merged into `main` as baseline commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.
- GitHub Actions job conclusion: `success`; dependency install, Chromium install, Playwright run and artifact upload all completed successfully.
- PR #55 verification record reports **21 passed, 0 failed**, duration approximately 8.4 minutes.
- The run included TEST-E2E-009, TEST-E2E-010 and TEST-E2E-011, plus the cancellation/SOS scenarios from PR #56.

Interpretation: this is real CI evidence for the E2E code merged into the selected `main` baseline. It is not proof that every supported deployment configuration or production backend tenant has the same behavior.

### Unit tests and TypeScript

The historical `TEST-E2E-009-recon.md` records, on an earlier baseline (`d6ee640`, 2026-10-11/13):

- Jest: 51 suites, 397 tests passed, 0 failed.
- `npx tsc --noEmit`: exit 0.
- Playwright list at that time: 17 tests in 9 files.
- Full Playwright E2E was explicitly not run at that stage.

These are historical baseline results, **not a fresh run against commit `8cd07c9`**. They must not be presented as current-main Jest or TypeScript verification.

### Build / deployment status

The combined status on baseline commit `8cd07c9` reports a successful Vercel check. This establishes that the associated Vercel check completed successfully; it does not by itself provide the build log, prove runtime correctness, or validate live API/FSM integration.

## 3. E2E scenario coverage map

The current E2E index documents the following scenarios:

| ID | Scenario | Order creation / setup | Main coverage |
|---|---|---|---|
| 001 | Driver boarding by code in a voice order | API fixture | Driver boarding UI and state synchronization |
| 002 | Standard order | API fixture | Passenger/driver order lifecycle |
| 003 | Voting | API fixture | Multiple drivers and voting behavior |
| 004 | Offer | API fixture | Offer lifecycle and passenger selection |
| 005 | Driver declines selected offer | API fixture | Negative offer branch |
| 006 | Passenger cancels offer | API fixture | Passenger cancellation branch |
| 007 | Passenger SOS after Started | API fixture | Cancellation after trip start |
| 008 | Passenger creates order through UI | Real passenger form | Standard / Voting / Offer creation and saved order |
| 009 | Passenger form → driver → Started | Real passenger form | Full Standard path with one `b_id` across both roles |
| 010 | Driver finishes trip | API fixture | Started → Finished through driver UI |
| 011 | Driver interrupts trip | API fixture | Started → Canceled through driver UI |
| 012 | Passenger cancels Standard before assignment | Real passenger form | Pre-assignment cancellation through UI |

Important distinction: tests 002–007 and 010–011 use API-created orders as fixtures; they do not test order creation through the passenger form. TEST-E2E-008 tests form submission but not driver acceptance. TEST-E2E-009 covers the integrated form-to-driver path for Standard orders. Therefore, the suite has broad lifecycle coverage, but the full form-to-driver acceptance path is not documented for all three order modes.

## 4. Material test and contract caveats

### PILOT-GATE-01 — Boarding code is not validated by the backend

The E2E documentation records a live backend observation for tenant `gruzvill`:

- `set_start_state` with a deliberately incorrect `b_driver_code` returned success and moved the driver to `c_state=5`.
- The order response did not include `b_driver_code`.
- When the expected code is absent from the order, the frontend accepts any code with the expected 3–4 digit shape.
- Passing `b_driver_code` to `set_performer` is rejected by the backend; the frontend retries without it.

The current E2E negative case therefore checks malformed code shape, not rejection of a well-formed but incorrect code. This is not equivalent to server-side boarding-code validation. Treat it as a backend contract/security/business-rule gate before relying on boarding code as proof of passenger identity.

### PILOT-GATE-02 — Offer classification differs from the expected API contract

The E2E documentation records that on `gruzvill`, a created order with `b_cars_count=0` is read back as `"1"`. Consequently, the frontend's `b_cars_count`-based offer classifier cannot reliably distinguish Offer orders on this tenant. Existing E2E behavior checks are stronger than relying on this field alone, but the backend contract remains inconsistent.

### PILOT-GATE-03 — Live E2E uses shared test accounts and mutable backend state

The workflow explicitly serializes tests and uses a global queue because concurrent runs against the same live accounts/backend interfere with one another. CI retries once. A green run is useful evidence, but it does not replace a separate stability check without retries or a controlled tenant-specific acceptance run.

### PILOT-GATE-04 — Trace and artifact confidentiality needs a full pass

The Playwright configuration disables trace/video/screenshot for the `setup` project and strips its `error-context` attachment because login values appear in page snapshots. TEST-E2E-009 also disables trace because its trace was found to contain passenger/driver session tokens. Other projects retain traces on failure. Verify that their trace artifacts cannot expose authorization headers, cookies, storage state or other session secrets before treating artifact retention as safe.

## 5. Audit conclusions at this stage

| Area | Status | Evidence quality |
|---|---|---|
| Playwright full suite | Passed: 21/21 in CI run #175 | Verified CI run on PR head merged into selected main |
| Jest | 397/397 in historical report | Historical only; not rerun on selected main |
| TypeScript | `tsc --noEmit` exit 0 in historical report | Historical only; not rerun on selected main |
| Vercel check | Success on selected main commit | Status check only; detailed build/runtime evidence not inspected |
| Passenger form → driver → Started | Covered for Standard by TEST-E2E-009 | CI included this scenario |
| Boarding-code server validation | Not established; documented negative live observation | Open backend gate |
| Offer order classification | Inconsistent on documented tenant | Open backend/API contract gate |
| Production tenant and real-device acceptance | Not established by repository CI | Requires operational acceptance evidence |

**No overall pilot approval is issued by this report.** The E2E suite is green on the selected main baseline, but the backend boarding-code behavior, offer classification contract, current-main Jest/TypeScript rerun, artifact-secret review, and real-device/production acceptance remain open.

## 6. Next audit actions

1. Run Jest and TypeScript checks against the exact selected main commit and retain raw results.
2. Inspect the E2E run artifacts and trace redaction across every project, not only `setup` and TEST-E2E-009.
3. Confirm the intended backend behavior for boarding-code verification and implement/verify server-side enforcement if the code is an identity gate.
4. Resolve the Offer classification contract with backend owners and add a regression test against the real tenant.
5. Perform a controlled acceptance run on the intended pilot tenant and devices; record backend version/configuration and the exact tested commit.

## 7. Verification limitations and rerun status

A fresh local Jest/TypeScript run against the pinned baseline was attempted as the next audit action, but the execution environment could not resolve `github.com` while cloning the repository (DNS/network failure). The repository connector can inspect source and CI metadata but does not execute the project's npm scripts. Therefore:

- Current-main Jest: **not rerun** in this audit session.
- Current-main TypeScript: **not rerun** in this audit session.
- No pass/fail claim is made for either command on commit `8cd07c9`.
- The only confirmed current-baseline browser execution remains E2E run #175 on the PR head whose merged tree is the selected main baseline.

To close this evidence gap, run from a checkout of the pinned commit with the project's lockfile and Node version:

```bash
cd taxi
npm ci
npm run test:nix
npx tsc --noEmit
npm run build:nix
```

Record the exact `git rev-parse HEAD`, Node/npm versions, command exit codes, test totals, and build output. Do not update application code merely to make the audit commands pass; any resulting defect should be documented separately and handled through the agreed development workflow.

## 8. Inspection of the successful E2E run artifact

Downloaded and inspected the artifact for run #175 (`playwright-e2e-41347130101-1.zip`, artifact ID `13099604349`):

- Archive contains only `playwright-report/index.html` and `e2e-results/results.json`.
- No trace ZIP, screenshot, video, or page-snapshot attachment was present in this artifact.
- The JSON report contains no Playwright attachments.
- A basic scan of the report files found no Bearer-token pattern, authorization/cookie fields, access/refresh-token fields, or `.auth/` storage-state path. The word "password" appears in the minified HTML bundle/runtime, not as a detected credential value.

This supports a narrow conclusion about **this successful run's uploaded artifact only**. It does not establish that failure artifacts from other projects/runs are safe, nor does it inspect GitHub runner temporary files before cleanup. The broader trace/artifact confidentiality gate remains open until a deliberately failed, non-credential-bearing test run is reviewed for every project's attachment policy and report output.
