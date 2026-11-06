# 36. Direct API mutation paths bypassing the Legacy Gateway

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: mutation call sites that invoke `API.*` directly rather than passing through `LegacyBackendGateway`.
- Method: repository code search and source tracing of order, car, user-profile and file-upload mutation paths.
- No application source changed. No tests were executed.

## Executive result

The Gateway is not a universal backend boundary in the current frontend. Most order lifecycle commands now use it, but there are still direct API mutation paths:

1. Automatic expiration of Passenger Voting orders calls `API.cancelDrive` directly from a Saga.
2. Car create/edit/drive operations call API methods directly through Redux action creators; their mutation wrapper only marks start/end and does not normalize or classify the returned business response.
3. Registration/profile helper flows call `API.uploadFile` and `API.editUserAfterRegister` directly.
4. The direct Voting-expiration cancellation path does not use the Gateway's business-error validator or its Completed/Failed events.

This is a source-level finding. The backend response shapes and actual production frequency of false-success states remain unverified.

## 1. Confirmed direct mutation paths

### API-36-01 — Voting expiration cancellation bypasses Gateway

**File:** `src/state/orders/sagas.ts`, `cancelExpiredOrdersSaga`

Observed flow:
- Saga identifies Voting orders whose calculated cancellation time has expired.
- For each expired order it executes `yield* call(API.cancelDrive, order.b_id)`.
- On Promise resolution it immediately invokes the local timeout notification flow.
- On rejection it only logs the error and continues.

The direct call bypasses:
- `LegacyBackendGateway.observe`;
- `assertSuccessfulBackendResponse`;
- Gateway `backend.request.completed/failed` events and correlation metadata.

The API method `cancelDrive` itself returns `res.data` without checking `status` or `code`. Therefore a resolved HTTP-200 business-error envelope can be treated as a completed cancellation by this Saga. This is a concrete source-level false-success path if the endpoint returns such an envelope.

**Severity: High** for Voting expiry integrity.

**Recommendation:** route this mutation through a single validated boundary, then only report the order as cancelled after validated success or a readback confirms the terminal state. Do not rely on transport Promise resolution alone.

### API-36-02 — Car mutations use a separate unvalidated Redux wrapper

**File:** `src/state/cars/actionCreators.ts`

Observed:
- `createUserCar` calls `API.createUserCar` directly. It dispatches the create-success action only when `String(response.code) === '200'`, but returns the response in all cases.
- `edit` calls `API.editCar` through local `mutationThunk`.
- `drive` calls `API.driveCar` through the same local `mutationThunk`.
- This local thunk dispatches START_MUTATION, awaits the API Promise and always dispatches END_MUTATION in `finally`. It does not classify a resolved business-error response or publish a normalized failure event.

The Gateway currently wraps none of these car operations. API methods return response envelopes; `editCar` returns `data` without checking business status. `driveCar` has internal special handling for an already-driven 404 and a follow-up user synchronization, but it returns the resulting response envelope rather than using the shared Gateway validator.

**Severity: Medium.** The direct car flows have local response handling but no common business-error classification. Their UI consumers must be checked individually before claiming a visible false-success defect.

**Recommendation:** either extend the common validated backend boundary to car mutations or define a typed car-response classifier and require each mutation caller to use it. Keep the special `not_modified` idempotent outcome explicit.

### API-36-03 — Registration/profile helper uploads and updates bypass Gateway

**File:** `src/state/user/helpers.ts`

Observed:
- Registration document upload uses `API.uploadFile` directly and then calls `API.editUserAfterRegister`.
- Profile/document update helper also calls `API.uploadFile` directly and then `API.editUserAfterRegister`.
- `uploadFile` is a mutation (POST to `/dropbox/file`) and is exported from `API/index.ts`.
- `editUserAfterRegister` uses the same `_editUser` implementation with `authRequired: false`; it POSTs to `/user`.
- The Gateway exposes `uploadFile` and `editUser`, but these helper paths do not use those Gateway methods.

The helpers inspect upload response data in an ad hoc way:
- one path gathers `item.data?.data?.dl_id` without validating a canonical success envelope first;
- another checks `item.data.status === 'success'` and skips unsuccessful upload results, then proceeds to call `editUserAfterRegister` with the accumulated user data.

**Severity: Medium.** This creates inconsistent error interpretation and can result in a profile update proceeding with incomplete document IDs. Exact backend upload failure envelopes and the server's treatment of missing IDs are unverified.

**Recommendation:** normalize upload outcomes, require all mandatory uploads to succeed before profile update, and return an explicit partial-failure result rather than silently omitting failed document IDs.

## 2. Order mutation boundary map

The following current paths were checked:

| Operation | Current path | Gateway validation |
|---|---|---|
| Passenger create/cancel/select/release/waiting/price/finish | `LegacyPassengerGateway` → `backendGateway` | Yes |
| Passenger rating | `RatingModal` → `backendGateway.setOrderRating` | Yes |
| Driver offer/voting participation/take | UI → `backendGateway` | Yes |
| Driver arrive/start/finish/cancel | UI → `driverMapGateway` → configured command transport or Gateway fallback | Gateway only on legacy fallback; command path has its own completion protocol |
| Voting expiry auto-cancel | Saga → `API.cancelDrive` | **No** |
| Active/ready/history/order reads | Saga → `API.getOrders/getOrder` | Read paths; outside mutation scope |

This reconciles a broad search result: direct calls in `actionCreators.ts` are Redux thunk implementations, while the Passenger/Driver UI call sites predominantly use Gateway methods. The confirmed lifecycle bypass is the expiry Saga.

## 3. Additional non-order mutation boundary

Car and registration/profile helper operations are outside the order lifecycle but are still backend mutations. They should not be treated as evidence that the order lifecycle is fully Gateway-backed, nor should their presence be conflated with order-command bypasses.

## 4. Tests and evidence gaps

- Existing Gateway tests cover transport rejection, success events and one HTTP-200 `status: 'error'` envelope.
- No test was found in the inspected files for `cancelExpiredOrdersSaga` asserting that an expired Voting order is cancelled only after a validated backend success.
- No parity test proves that Saga cancellation and Gateway cancellation classify the same response.
- The car mutation wrapper has no visible test in the inspected action-creator source asserting business-error classification.
- Registration/profile helper tests were not inspected or executed in this stage.
- No new tests were added and no Jest, TypeScript, build or E2E command was run.

## 5. Required remediation and verification

1. Replace the direct Saga call to `API.cancelDrive` with a validated boundary call.
2. Add a Saga test where cancellation resolves with `{ status: 'error', code: '200' }`; assert that success notification is not shown and that failure is recorded.
3. Add parity coverage proving Gateway and all mutation thunks classify the same canonical response envelope identically.
4. Audit the car mutation consumers for whether resolved non-200 response envelopes are surfaced as failures.
5. Make registration/profile updates fail explicitly when a required upload fails; test missing/invalid `dl_id` and failed final profile update.
6. After implementation, rerun focused Jest, TypeScript, production build and E2E. Runtime execution remains blocked as recorded in stage 31.

## 6. Pilot disposition

- Main Passenger/Driver order UI: predominantly Gateway-backed, with configured FSM command path handled separately.
- Voting expiration cancellation: direct API bypass confirmed; business-error false-success possible.
- Car and profile mutations: separate direct API paths with local/ad hoc response handling.
- Backend response-envelope behavior on the Morocco pilot tenant: unverified.
- **Order mutation boundary completeness: NO-GO** until the Voting-expiration bypass is fixed and covered.

## Evidence links

- [sagas.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/sagas.ts)
- [actionCreators.ts — orders](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/actionCreators.ts)
- [actionCreators.ts — cars](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/actionCreators.ts)
- [user/helpers.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/user/helpers.ts)
- [API/order.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/API/order.ts)
- [API/car.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/API/car.ts)
- [LegacyBackendGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyBackendGateway.ts)
- [LegacyPassengerGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyPassengerGateway.ts)

