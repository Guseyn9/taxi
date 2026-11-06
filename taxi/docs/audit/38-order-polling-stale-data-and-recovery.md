# 38. Order polling, stale data and recovery after failed mutations

## Scope and baseline
- Repository: Guseyn9/taxi
- Source baseline: main at 8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf
- Audit branch: audit/frontend-inventory
- Method: static source tracing of Redux Saga polling, order reducers/selectors, FSM snapshot polling and existing focused tests.
- No application source changed. No tests executed in this stage.

## Executive result
The frontend has recurring polling and explicit single-order refresh, but recovery is not reliable in all failure paths. A concrete deadlock exists: an order watcher can wait forever if its GET is skipped while a mutation is in progress and that mutation later fails. Mutation failures also do not mark the order stale or automatically trigger readback. Existing tests document a second stale-data hazard: fresh active-list data updates `partial`, but a stale `value` continues to win in the single-order selector until `GET_ORDER_SUCCESS` occurs.

## UI-38-01 — Order watcher can stop polling after GET is skipped during mutation
**Severity: P0/P1 — depending on how often long-running mutations overlap polling.**

Files: `src/state/orders/sagas.ts`, `src/tools/sagaUtils.ts`, `src/state/orders/actionCreators.ts`.

Observed sequence:
1. `watchOrderSaga` dispatches `GET_ORDER_REQUEST` and waits for `GET_ORDER_SUCCESS`, `GET_ORDER_NOT_FOUND` or `GET_ORDER_FAIL` for that order.
2. `getOrderSaga` checks `orders[id].mutations`. If nonzero, it skips the request and emits none of the three completion actions.
3. `whileWatching` invokes the watcher loop again only after the current loop returns. The watcher is currently blocked in `take(...)`.
4. `mutationThunk` dispatches `MUTATION_FAIL` after a rejected mutation, but `watchOrderSaga` does not wait for that action and `MUTATION_FAIL` does not start a readback.

Result: if the watcher request lands while a mutation is pending and the mutation subsequently fails, the per-order polling loop can remain blocked indefinitely. This is a source-level control-flow conclusion; runtime reproduction was not run.

Recommendation: every GET request must produce a terminal outcome, including an explicit skipped/deferred result; alternatively queue a fresh GET after mutation completion (success or failure). A mutation failure with ambiguous transport outcome must schedule authoritative readback.

## UI-38-02 — Mutation failure does not mark data stale or request reconciliation
**Severity: High.**

Files: `src/state/orders/actionCreators.ts`, `src/state/orders/reducer.ts`.

Observed:
- `mutationThunk` dispatches `MUTATION_FAIL` on a rejected Promise and rethrows.
- Reducer handles `MUTATION_FAIL` by decrementing the mutation counter only.
- Only `UPDATE_SUCCESS` sets `stale = true`.
- `UPDATE_SUCCESS` is included in the order-fetch concurrency watcher and causes `getOrderSaga` to run; `MUTATION_FAIL` is not.

Therefore a timeout/network rejection leaves the previous stored order untouched and does not itself request a readback. Because a lost response can follow a server-side commit, the UI cannot infer that the server rejected the operation merely from the rejected browser request.

Recommendation: distinguish definite business rejection from unknown transport outcome. For unknown outcome, mark stale and perform readback before enabling a retry. Do not blindly replay non-idempotent mutations.

## UI-38-03 — Active-list refresh does not necessarily refresh the single-order value
**Severity: High when the same order is consumed by both list/map and order-detail selectors.**

Files: `src/state/orders/reducer.ts`, `src/state/orders/selectors.ts`, `src/state/orders/__tests__/refreshOrder.test.js`.

Observed reducer behavior:
- Active/ready/history list success writes new order data to `partial`.
- Single-order success writes to `value` and clears `stale`.
- `ordersSelectors.order` returns `value ?? partial`.

The existing `refreshOrder.test.js` explicitly documents and tests this case: an order has `value=ARRIVED`; a fresh active-list response carries `STARTED` and updates `partial`; selector still returns `ARRIVED` because `value` takes precedence. Only a single-order `GET_ORDER_SUCCESS` updates `value` to `STARTED`.

This means `refreshActiveOrders()` alone is not a sufficient recovery strategy for consumers reading `ordersSelectors.order`. The test and code confirm the behavior; no claim is made that every UI path uses this selector.

Recommendation: define one freshness/merge policy. Either update `value` when a newer list snapshot arrives, remove the duplicate value/partial authority, or require and verify a single-order readback for all affected consumers.

## UI-38-04 — Existing watch loops do retry ordinary request failures
**Positive behavior observed.**

Files: `src/state/orders/sagas.ts`, `src/tools/sagaUtils.ts`.

- Active orders are polled every 5 seconds; ready every 3 seconds; history every 10 seconds; individual orders every 5 seconds. Android Chrome applies a 1.75x adaptive interval.
- Active/ready/history watcher loops wait for SUCCESS or FAIL, then delay and issue another request.
- Individual order watcher waits for SUCCESS, NOT_FOUND or FAIL, then delays and loops.
- `whileWatching` maintains one loop per key while listener count remains positive.
- Active-list request failures emit `GET_ACTIVE_ORDERS_FAIL`; previous Redux list is not replaced by an empty list in that catch path.

These retries cover ordinary requests that emit their expected terminal action. They do not fix UI-38-01, where no terminal action is emitted because the GET worker skips itself.

## UI-38-05 — FSM driver snapshot polling silently discards polling errors
**Severity: Medium / operational observability gap.**

File: `src/platform/adapters/FsmDriverSnapshotTransport.ts`.

Observed:
- Driver FSM snapshot provider subscribes to realtime and also polls at `recoveryPollIntervalMs` (default 5 seconds).
- Poll errors are caught with `.catch(() => undefined)`.
- Accepted snapshots are protected against stale query sequence, realtime epoch and non-increasing server revision (or older `updatedAt` when revision is absent).

Positive: out-of-order/old snapshots are rejected. Risk: repeated HTTP/protocol failures in the recovery poll are invisible at this adapter boundary; the last accepted snapshot remains in use without a surfaced degraded/freshness state. Whether higher layers separately expose disconnect status depends on the realtime transport and is not proven here.

Recommendation: retain stale-snapshot protection, but publish a recoverable health signal with last successful timestamp, consecutive failure count and explicit stale state. Do not replace the last known good snapshot with empty data.

## UI-38-06 — Existing tests already identify the dual-slice freshness issue
File: `src/state/orders/__tests__/refreshOrder.test.js`.

Observed tests cover:
- refreshOrder dispatches the same GET_ORDER_REQUEST handled by getOrderSaga;
- a single-order GET success updates the driver state consumed by the order selector;
- a request without a response does not optimistically change ARRIVED to STARTED;
- `state/order` and `state/orders` are separate slices;
- active-list success updates `partial` but does not supersede stale `value`.

The test file is source evidence of intended behavior and prior bug recognition, not evidence that the suite currently passes. No test command was executed in this audit.

## Evidence classification
| Claim | Classification |
|---|---|
| Watcher waits for terminal GET action; GET saga may skip without dispatching one during mutation | Observed in source |
| MUTATION_FAIL does not set stale or trigger GET | Observed in source |
| Active list updates partial while value takes precedence | Observed in source and asserted by existing test source |
| Normal active/ready/history/order failures return a terminal FAIL action and allow next poll cycle | Observed in source |
| FSM snapshot polling defaults to 5 seconds and suppresses poll rejection at call site | Observed in source |
| Runtime deadlock reproduced with real network timing | Not tested |
| Morocco tenant/backend eventually converges after lost response | Unverified |
| Jest tests pass on current main | Not tested |

## Remediation order
1. **P0:** remove the silent skip in `getOrderSaga`; every request must resolve to success/not-found/fail/deferred, and the watcher must resume after mutation completion.
2. **P0:** on unknown mutation outcome, mark order stale and schedule authoritative readback. Keep definite business rejection distinct.
3. **P1:** unify `value`/`partial` freshness semantics so active-list refresh cannot be hidden by an older detail value.
4. **P1:** expose FSM snapshot polling health and last successful revision/time without discarding last known good state.
5. Add deterministic tests for: GET requested during mutation then mutation failure; GET requested during mutation then mutation success; lost mutation response with server commit; stale detail value plus newer active-list state; repeated FSM snapshot poll failure and recovery.

## Pilot disposition
**NO-GO** for treating frontend state as reliably reconciled after a failed or timed-out mutation until UI-38-01 and UI-38-02 are fixed. UI-38-03 must be resolved for screens that consume the single-order selector. FSM snapshot poll health should be visible before broader pilot rollout.

No application source, tests, CI workflow or runtime configuration were changed. No Jest, TypeScript, build or E2E execution was performed.

## Evidence links
- [orders sagas](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/sagas.ts)
- [orders action creators](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/actionCreators.ts)
- [orders reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/reducer.ts)
- [orders selectors](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/selectors.ts)
- [refreshOrder tests](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/__tests__/refreshOrder.test.js)
- [sagaUtils](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/sagaUtils.ts)
- [FSM Driver snapshot transport](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/FsmDriverSnapshotTransport.ts)
- [Driver command completion waiter](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/DriverCommandCompletionWaiter.ts)