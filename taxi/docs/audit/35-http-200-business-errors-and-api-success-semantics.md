# 35. HTTP-200 business errors and API success semantics

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: HTTP-200 business-error detection, response validation in the Legacy Gateway and Redux mutation thunks, and consistency of mutation outcomes.
- Method: source and existing unit-test review. No backend source, live response capture, or new test execution was available. No application source changed.

## Executive result

There is no single response-success contract across the frontend.

1. `LegacyBackendGateway.observe` validates a resolved API response with `assertSuccessfulBackendResponse`: it rejects exact `status === 'error'` and any present `code` whose string value is not `'200'`.
2. Redux `APIMutationThunk` uses a different rule: it checks only `value.code !== '200'`.
3. Several API methods reject `status === 'error'` themselves; others simply return `res.data` and rely on the caller to inspect the business response.
4. The Passenger command adapter uses `backendGateway`, so its mutations pass through Gateway validation. Some Redux order mutations still call API methods directly and use the separate thunk rule.

The same business response can therefore be classified differently depending on the call path. This is a source-confirmed contract inconsistency; whether the backend actually emits the problematic combinations is unverified.

## 1. The two validators are not equivalent

### Gateway validator

File: `src/platform/adapters/backendError.ts`

`assertSuccessfulBackendResponse` rejects when:
- `status === 'error'`; or
- `code` is present and `String(code) !== '200'`.

It accepts responses with no `code` when `status` is not exactly `'error'`. It does not reject uppercase `'ERROR'`, boolean failure flags, or arbitrary failure-shaped fields unless accompanied by one of the two recognized markers.

### Redux mutation validator

File: `src/state/orders/actionCreators.ts`

`APIMutationThunk` calls `mutationThunk` with:
`value => value.code !== '200'`.

It ignores `status`. A response with `status: 'error'` and `code: '200'` is therefore marked `UPDATE_SUCCESS` in this path. A response with `status: 'ok'` but no `code` is marked `MUTATION_FAIL`.

### Truth table

| Response | Gateway | Redux APIMutationThunk |
|---|---|---|
| `{ code: '200', status: 'ok' }` | Success | Success |
| `{ code: '200', status: 'error' }` | Reject | Success classification |
| `{ code: '409', status: 'error' }` | Reject | Failure classification |
| `{ status: 'ok' }` | Success | Failure classification |
| `{ status: 'error' }` | Reject | Failure classification (`undefined !== '200'`) |
| `{ code: 200 }` | Success (string-normalized) | Failure (strict string comparison) |

The last row is another concrete difference: Gateway accepts numeric 200; Redux thunk does not.

## 2. Mutation call-path map

### Order mutations using the Redux thunk path

In `src/state/orders/actionCreators.ts`:
- `cancel(id)` calls `API.cancelDrive` through `APIMutationThunk`.
- `setState(id, ...)` calls `API.setOrderState` through `APIMutationThunk`.
- `take(id, options)` calls `API.takeOrder` through generic `mutationThunk`, whose default `isFail` always returns false. Its API implementation currently rejects exact `status === 'error'` in its POST helper, but the thunk itself does not inspect resolved business response codes.
- `create(...)` calls `API.postDrive` directly and dispatches `CREATE_SUCCESS` after it resolves.

### Order mutations behind LegacyBackendGateway

`LegacyBackendGateway` wraps `cancelDrive`, `setOrderState`, `setOrderRating`, `setWaitingTime`, `takeOrder`, `postDrive`, `chooseCandidate`, `releaseCandidateChoice`, `sendOrderOffer`, `participateVotingOrder`, and `updateOrderCustomerPrice`, among other methods.

Every wrapped method validates its resolved result with `assertSuccessfulBackendResponse`, publishes Completed only after validation, and publishes Failed/rejects on validation or transport errors.

DriverMap's Legacy lifecycle path uses this Gateway. Passenger mutation handlers also call the Gateway for create, cancel, candidate selection, waiting-time update, customer-price update and finish.

### API-level checks are inconsistent

Examples from `src/API/order.ts`:

- `cancelDrive`: returns `res.data` without checking `status`; correctness depends on the caller.
- `setOrderState`: rejects exact `status === 'error'` itself.
- `setOrderRating` and `setWaitingTime`: return `res.data` without their own business-error check; Gateway validation catches recognized markers when these are called through it.
- `takeOrder`, `sendOrderOffer`, `participateVotingOrder`, `chooseCandidate`, `releaseCandidateChoice` and `cancelVotingParticipation`: their shown POST paths reject exact `status === 'error'`.
- `postDrive`: rejects exact `response.data.status === 'error'` for the create request, but its follow-up Voting confirmation request is only awaited inside a try/catch that logs and suppresses errors. The order can be returned as created even if that secondary confirmation action fails.

This last behavior is a separate partial-success contract: order creation and Voting confirmation are two backend mutations, but the API exposes only the created order result and suppresses a failure of the second mutation.

## 3. Findings

### API-35-01 — Different response validators can disagree about success

**Severity: High**

**Observed:** Gateway and Redux thunk use different predicates. The response `{ status: 'error', code: '200' }` is rejected by Gateway but treated as success by `APIMutationThunk`. Numeric `code: 200` and missing-code success responses also differ.

**Impact:** Redux may dispatch `UPDATE_SUCCESS` and refresh/close UI despite a business failure if the backend emits the conflicting shape. Different UI paths can show different outcomes for the same API result.

**Recommendation:** define one shared response classifier and use it in API adapters and Redux mutation thunks. Preserve endpoint-specific response contracts explicitly rather than using separate ad hoc predicates.

### API-35-02 — API methods rely on callers to detect business errors

**Severity: Medium/High**

**Observed:** `cancelDrive`, `setOrderRating` and `setWaitingTime` return resolved `res.data` without API-level business-error rejection. Gateway callers validate; direct Redux callers may use a different rule or no rule.

**Impact:** correctness depends on the call path, not solely on the endpoint contract. A future direct API caller can accidentally treat a business failure as a successful Promise resolution.

**Recommendation:** move response normalization to a single API boundary, or make the raw-response contract explicit in types and require every caller to pass through one validator.

### API-35-03 — Voting order creation suppresses failure of its follow-up confirmation

**Severity: High for Voting creation integrity**

**Observed:** after `postDrive` creates an order, Voting mode sends a second `SetConfirmState` request. The request is inside `try/catch` and failure is only logged; `postDrive` still returns the created order.

**Impact:** caller receives a successful creation result even if the additional Voting confirmation did not succeed. The UI may continue into the Voting flow while the backend order is not in the required confirmation state.

**Recommendation:** return an explicit partial-success result or reject/compensate when confirmation is required for a valid Voting order. At minimum, verify the confirmation state by readback before presenting the Voting order as ready.

### API-35-04 — Generic mutation thunk defaults to success for every resolved value

**Severity: Medium**

**Observed:** `mutationThunk` defaults `isFail` to `() => false`. The `take` action uses this generic path, so any resolved response is classified as `UPDATE_SUCCESS`. The current `takeOrder` POST helper rejects exact `status === 'error'`, but it does not apply the Gateway's full `code` validation to every resolved response.

**Impact:** a backend failure shape not covered by the API helper may be classified as successful by Redux. The default makes future mutations easy to wire incorrectly.

**Recommendation:** require an explicit response classifier for mutation thunks, or make the default fail closed for response envelopes with known business status/code fields.

## 4. Existing test coverage

`src/platform/adapters/__tests__/LegacyBackendGateway.test.js` tests:
- transport rejection normalization;
- successful result event;
- an HTTP-200 payload with `status: 'error'`.

It does not test:
- `status: 'error'` together with `code: '200'`;
- numeric `code: 200`;
- missing `code` success shape;
- unknown or uppercase status markers;
- parity between Gateway and Redux `APIMutationThunk`.

`LegacyPassengerGateway.test.js` tests transport rejection and mapping Passenger completion to Finished, but it does not test a resolved business-error response flowing through the Gateway.

No tests were executed in this stage.

## 5. Required verification and remediation

1. Add table-driven tests for a canonical response classifier covering string/numeric code, missing code, status error, status ok and unknown status.
2. Add a parity test proving Redux and Gateway classify the same response identically.
3. Inspect sanitized response envelopes from the actual target tenant for create, cancel, take, set state, rating, waiting-time and candidate selection. Do not log tokens, hashes or personal data.
4. Make Voting creation expose the result of the follow-up confirmation; test failure and readback.
5. Audit all direct `API.*` mutation call sites so that no mutation bypasses the canonical classifier.
6. Re-run focused Jest tests, TypeScript and E2E after remediation; stage 31's runtime limitation remains open.

## 6. Pilot disposition

- **Gateway HTTP-200 business-error handling:** present, but recognizes only two markers.
- **Redux/Gateway semantic parity:** not achieved.
- **Voting creation partial success:** present and not surfaced as a distinct result.
- **Backend response-shape compatibility on Morocco pilot tenant:** unverified.
- **Overall error-contract readiness:** NO-GO until the shared classifier and Voting partial-success behavior are resolved and tested.

## Evidence links

- [backendError.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/backendError.ts)
- [LegacyBackendGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyBackendGateway.ts)
- [LegacyBackendGateway.test.js](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/__tests__/LegacyBackendGateway.test.js)
- [LegacyPassengerGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyPassengerGateway.ts)
- [order.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/API/order.ts)
- [actionCreators.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/actionCreators.ts)
- [Stage 02 API register](./02-api-register.md)
- [Stage 25 timeout and recovery](./25-api-failures-timeouts-and-recovery.md)

