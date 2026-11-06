# 43. Frontend test-coverage reconciliation for order polling, sessions, vehicle capacity and GPS

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: reconcile test-source claims in stages 38–42 against the actual test tree and inspect the focused tests for order refresh, ready-order polling and vehicle capacity.
- Method: GitHub source inspection at the pinned baseline. No application source changed. No tests were executed.

## Executive result

This pass found one documentation error in stage 40: a dedicated `src/tools/driverCapacity.test.ts` exists at the pinned baseline. It provides meaningful unit coverage for passenger counts, occupied seats, filtering and the four-seat fallback. It does **not** validate the car-class fallback, malformed capacity values, or the real multi-car selector/activation behavior. The stage 40 statement that no dedicated test file was found is therefore corrected here.

The review also confirms that the focused tests for order refresh and ready-order polling exist, but they do not close the recovery, stale-state, or primary-versus-driven-car gaps identified in stages 38 and 40. The stage 39 and 41 session/GPS findings remain without corresponding dedicated lifecycle tests in the inspected test tree.

## Correction to stage 40

The following sentence in stage 40 is inaccurate:

> no matching dedicated test file was found in the repository search performed for this stage.

Actual source at the pinned baseline:
- `src/tools/driverCapacity.test.ts` imports and tests `getCarCapacity`, `getDriverFreeSeats`, `canDriverTakeOrderBySeats`, `filterOrdersByFreeSeats`, and `getOrderSeatsCount`.
- It verifies explicit `car.seats`, missing capacity falling back to `DEFAULT_CAR_SEATS`, occupancy in Performer/Arrived/Started states, exclusion of other drivers/Considering/Canceled states, and order filtering.

Coverage boundaries:
- No test supplies `cc_id` with a known `SITE_CONSTANTS.CAR_CLASSES[cc_id].seats` value.
- No test checks zero, negative, fractional, string, NaN-like, or otherwise malformed `car.seats` values.
- No test proves that the four-seat fallback is valid for Moroccan vehicle classes; that is a business/configuration rule, not something established by the current unit tests.
- No test exercises the integration between `userPrimaryCar`, `userDrivenCar`, ready-order recovery, map/list capacity, and profit estimation with multiple cars.
- Presence of the test source does not establish that Jest currently passes; this audit did not execute it.

The finding UI-40-03 remains valid as a source/configuration concern, but its test-coverage description is narrowed: a focused unit test exists, while important fallback branches and tenant correctness are not covered.

## Reconciled evidence by stage

| Prior stage | Test source confirmed | What remains unproven |
|---|---|---|
| 38 — Order polling and stale data | `src/state/orders/__tests__/refreshOrder.test.js`; `src/state/orders/__tests__/readyOrdersPolling.test.js` | No test for GET skipped during mutation followed by MUTATION_FAIL and watcher recovery; no test for reconciliation after ambiguous mutation failure; existing refresh test explicitly preserves stale `value` over newer list `partial`. |
| 39 — Session restoration and account isolation | No dedicated same-context logout/login or account-switch isolation test identified in the inspected test-file inventory | Domain-slice teardown, same-user reload freshness, stale in-flight response fencing and passenger draft isolation remain unproven by dedicated lifecycle tests. |
| 40 — Driver cars and capacity | `src/tools/driverCapacity.test.ts`; `src/state/orders/__tests__/readyOrdersPolling.test.js` | Unit helper coverage exists, but not class fallback/malformed values or multiple-car integration. Ready-order polling test mocks only the primary-car selector and does not distinguish a non-first driven car. |
| 41 — Driver GPS | `src/tools/driverLocationLog.test.ts` covers diagnostic logging | No dedicated test identified for geolocation acquisition failure, stale Redux fix suppression, send lifecycle, permission denial, background/resume or ordinary non-emulator activation. |
| 42 — Backend location contract | No frontend test found for location send/readback/dispatch/stale expiry as a complete contract | Server persistence, freshness, expiry and dispatch are backend matters and are explicitly deferred to the independent backend audit and later integration audit. |

## Frontend-only conclusions

1. The test suite contains more focused coverage than the stage 40 report recorded; the correction is important and is made without weakening the remaining finding.
2. The most consequential uncovered frontend paths remain mutation-failure reconciliation, same-context session/account teardown, multi-car active-vehicle consistency, and ordinary Driver GPS acquisition/send recovery.
3. Stage 42's backend implementation questions are not blockers to completing the independent static frontend audit. They are retained as explicit cross-boundary questions for the later integration phase, not treated as frontend defects.
4. This pass does not claim a current green Jest run, TypeScript check, production build, or E2E pass.

## Next frontend work

Continue with a source-only frontend closure pass, in this order:
1. Reconcile all prior findings against current source and test files; correct any other inaccurate test-coverage statements.
2. Complete frontend-only security/public-surface and browser-delivery evidence that can be established from the repository.
3. Establish executable frontend test evidence on the pinned SHA (Jest, TypeScript and production build) when a reproducible runner is available. Do not mix backend contract or tenant acceptance into this result.
4. Publish a frontend-only closure matrix: fixed/verified, open frontend defect, test gap, and external dependency deferred to integration.

The independent backend audit starts only after this frontend audit is closed. Cross-layer validation follows both.

## Evidence classification

- **Observed in source:** the test files and assertions listed above exist at the pinned baseline.
- **Not executed:** no Jest, TypeScript, build or E2E command was run during this stage.
- **Deferred to backend/integration:** server-side location persistence, dispatch rules, timestamp freshness/expiry and real tenant vehicle-class correctness.

No application source, tests, CI workflow or runtime configuration were changed.
