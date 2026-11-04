# Stage 23 — Cross-role order-state synchronization

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: how Passenger and Driver observe an order changed by either role; polling, detail subscriptions, Redux collection/detail projections, optimistic transitions, mutation failures and recovery.
- This is a source-level audit. It does not prove deployed polling intervals, backend consistency, multi-device timing or production configuration.
- No application source was changed.

## Executive result

The reviewed implementation is predominantly polling-based, not a single shared realtime order-state stream. Passenger active-order collection polling is started by the Passenger screen. Driver active/ready/history polling is started only when the driver's `emulatorOrdersEnabled` condition is true. Individual order detail subscriptions poll separately. Driver map transitions explicitly request a detail refresh and active-list refresh, while other command paths depend on Redux mutation completion or a later collection poll.

This creates several independent read paths and update clocks. A successful backend mutation does not by itself prove that every visible representation (passenger selected order, driver card, map plan, active list and detail page) has converged.

## Observed source behavior

### 1. Polling and subscriptions

In `src/state/orders/sagas.ts`:

| Read path | Base interval | Notes |
|---|---:|---|
| Active orders, client | 5 s | `watchActiveOrdersSaga` |
| Active orders, driver | 5 s | same watcher, role-specific constant |
| Ready orders | 3 s | driver order offers/list |
| History | 10 s | driver history |
| One order detail | 5 s | keyed `watchOrderSaga` |
 
On Android Chrome, `getAdaptivePollInterval` multiplies these intervals by 1.75. The watcher issues a request, waits for its matching SUCCESS/FAIL event, then delays before the next cycle. Therefore the effective observation delay also includes request latency and can exceed the nominal interval.

The Passenger page starts `watchActiveOrders` on mount. The Driver page starts active, ready and history watchers only when `user.u_role === Driver && emulatorOrdersEnabled`. The latter is an important configuration gate: source alone does not establish that ordinary production drivers receive these collection polls. This was already flagged as a configuration/runtime verification item in Stage 22; it must not be interpreted as proof that production drivers receive no orders.

A separate order-detail watcher is available through `watchOrder(id)`. `CardModal` uses it while active. The order details page also refreshes its separate detail slice on a 3-second interval. These are separate read paths, not a server-pushed common snapshot.

### 2. Collection and detail are separate Redux projections

The orders reducer stores, per order:
- `partial`: the compact object received through active/ready/history collection responses;
- `value`: the full object received through `GET_ORDER_SUCCESS`;
- listener and mutation counters;
- a stale flag.

The public `orders` selector chooses `value ?? partial`. Collection SUCCESS updates `partial`; detail SUCCESS updates `value`. Consequently, when a full detail value already exists, a later collection poll can refresh its partial object without changing the object selected for the UI. The selected detail can therefore lag behind a newer active-list response until its own detail read succeeds. This is the concrete manifestation of the previously recorded STATE-01 risk.

The Passenger screen derives its selected order from the active-order collection and its selected ID. Its selection effect clears the selection when the selected order is absent from the latest active list. The client does not have an independent durable selected-order snapshot in this path (see Stage 21).

### 3. Mutation completion and refresh paths

`orders/actionCreators.ts` wraps `cancel`, `take` and `setState` in a mutation thunk:
1. dispatch `MUTATION_START`;
2. call the API;
3. dispatch `UPDATE_SUCCESS` or `MUTATION_FAIL`;
4. rethrow rejected promises.

For `cancel` and `setState`, `APIMutationThunk` also treats a non-`200` response code as failure. The `take` thunk uses the default failure predicate, which only treats a rejected promise as failure; it does not inspect a resolved response's `code` in this wrapper.

`UPDATE_SUCCESS` triggers `getOrderSaga` for that order. The detail read is thus an asynchronous follow-up, not an update from the mutation response itself. The Saga skips the read when the order record currently has a nonzero mutation count.

The Driver Map path uses a separate explicit strategy. After a map transition, `refreshMapOrderState` requests the detail record and refreshes the active list immediately and again after 1.5 seconds. The transition wrapper runs that refresh in `finally`, including after a rejected command. The map also records an optimistic driver state before sending the command. This is a deliberate reconciliation attempt, but a refresh request is not proof that the backend accepted the transition; errors in the map transition path are logged to console and the visible error/retry behavior is limited.

### 4. Cross-role visibility

A passenger mutation is normally observed by the passenger's active-order polling and any detail-specific read. A driver mutation is observed by the driver's active-order polling, the passenger's active-order polling, and any active detail subscription. There is no single client-side event bus that guarantees all those projections update atomically.

For example, after a driver moves an order from Arrived to Started:
- the driver map applies an optimistic state and explicitly refreshes detail and active collection;
- the passenger active collection can observe the backend change on its next poll;
- the passenger's selected order may still be sourced from a different full/partial cache entry;
- the driver and passenger screens can therefore temporarily show different states.

The source supports eventual polling-based convergence when the requests succeed and the relevant watchers are active. It does not establish a strict maximum convergence time under request latency, hidden tabs, network errors, inactive watchers or backend delay.

## Findings

### SYNC-23-01 — Passenger active-order state is polling-based, not pushed

**Severity: Medium**

**Observed:** Passenger mounts `watchActiveOrders`; active collection refreshes every 5 seconds (nominal), with Android Chrome adaptation. No shared websocket/SSE subscription is wired into this collection watcher.

**Impact:** A state change made by a driver on another device may not be reflected immediately in the passenger UI. The nominal delay is not a hard upper bound.

**Recommendation:** Keep the polling model if acceptable for pilot, but make the refresh contract explicit. For critical transitions, trigger an immediate refresh/readback and show a pending/reconciling state rather than implying the backend state has already propagated.

### SYNC-23-02 — Driver collection polling is conditional on emulatorOrdersEnabled

**Severity: High — configuration-dependent; runtime confirmation required**

**Observed:** Driver active, ready and history watchers are all guarded by `emulatorOrdersEnabled` in `pages/Driver/index.tsx`. The orders Saga also contains an emulator-only forced-empty path for drivers when neither browser nor external emulator is enabled.

**Impact:** Driver collection visibility depends on the resolved emulator configuration. The reviewed source does not establish the ordinary production value of that flag or an alternative production collection subscription.

**Recommendation:** Verify the deployed production configuration and capture one ordinary-driver session proving the active/ready endpoints are requested. Do not close this finding based solely on a local emulator or QA build.

### SYNC-23-03 — Full detail can mask fresher collection data

**Severity: Medium**

**Observed:** Collection responses update `partial`; detail responses update `value`; selectors prefer `value ?? partial`. A later collection poll therefore cannot replace a previously loaded full value.

**Impact:** The active list can contain a newer order state while a detail/card consumer still renders an older full object. This can produce temporary disagreement between list, card and selected-order surfaces.

**Recommendation:** Define freshness/revision semantics for both projections. Prefer server revision or updated-at ordering when merging; do not let the presence of any full value automatically outrank a newer partial value. Add a regression test where a collection response advances `c_state` after a detail response.

### SYNC-23-04 — Driver Map has an explicit reconciliation path, but it is not a general mutation contract

**Severity: Medium**

**Observed:** Map transitions optimistically store the next driver state, then call detail refresh + active-list refresh immediately and after 1.5 seconds. Other mutation paths rely on `UPDATE_SUCCESS` → detail read or the next list poll.

**Impact:** Recovery behavior differs by entry point. A future action routed outside Driver Map may not get the same immediate list reconciliation. Also, the map refresh in `finally` runs after both success and failure, so a refreshed state—not command completion alone—must decide what the UI should show.

**Recommendation:** Centralize post-mutation reconciliation by order ID and mutation result. Ensure every state-changing command refreshes the projections it affects, and make failed command/readback status visible and retryable.

### SYNC-23-05 — A detail watcher can wait indefinitely after a suppressed read and failed mutation

**Severity: Medium**

**Observed:** `getOrderSaga` emits no SUCCESS/NOT_FOUND/FAIL event when it skips a detail read because the order has an in-flight mutation. `watchOrderSaga` waits specifically for one of those terminal read events before delaying and issuing the next poll. `MUTATION_FAIL` is not one of the events that releases that wait; unlike `UPDATE_SUCCESS`, it does not trigger the detail-read Saga.

**Impact:** If a detail poll overlaps a mutation and that mutation fails, the detail watcher can remain blocked until some other code explicitly dispatches a new detail request. The active-order collection watcher is separate and may continue, so the detail view can remain stale while the list updates.

**Recommendation:** Make every skipped detail request produce a terminal/retry signal, or have mutation failure explicitly schedule a detail refresh. Add a deterministic Saga test for poll → mutation-start → poll skipped → mutation-fail → watcher resumes.

### SYNC-23-06 — Cross-device and cross-role convergence is not proven by the current E2E evidence

**Severity: Medium**

**Observed:** The repository has a documented integrated Standard order E2E scenario, but the reviewed test evidence does not establish two independent browser sessions/devices observing each other's transitions with bounded convergence, nor recovery after a transient read failure on one role.

**Impact:** A green single-flow E2E does not prove the passenger and driver projections remain synchronized under realistic network timing, retries and independent sessions.

**Recommendation:** Add an E2E matrix with separate Passenger and Driver contexts: create → assign → Arrived → Started → Finished, plus cancel and failed-read recovery. Assert both sides' displayed states after each backend transition and record elapsed convergence time.

## Lifecycle coverage matrix

| Transition / event | Mutation source observed | Other-side observation path | Source-level conclusion |
|---|---|---|---|
| Created | Passenger create thunk / `postDrive` | Passenger active-list poll; Driver ready-list poll (if enabled) | No atomic cross-role update |
| Assigned / Performer | Driver take / candidate or offer flow | Passenger active-list poll and detail read | Eventual observation only; mode/backend semantics vary |
| Arrived | Driver Map Gateway → backend state command | Passenger active-list poll/detail | Map explicitly refreshes driver's own detail/list; passenger waits for its watcher |
| Started | Driver Map Gateway or boarding confirmation path | Passenger active-list poll/detail | Same split read paths; boarding has a separate projection hook |
| Finished | Driver map completion command | Passenger active-list poll; driver active/history behavior | Removal/history semantics need backend readback and role-specific tests |
| Canceled | Passenger/Driver cancellation paths | Other role's active poll and any detail read | UI notifications can be inferred from disappearance; no shared push guarantee |

This table describes frontend call paths only. Exact backend state transitions, authorization, transaction atomicity and endpoint response semantics remain separate backend verification items.

## Tests and evidence to add

1. Reducer merge test: full detail value at state 4, then collection partial at state 5; verify selected order does not remain at state 4.
2. Saga test: a detail poll skipped during a mutation must resume after both mutation success and mutation failure.
3. Driver configuration test: production-like config must start the intended driver active/ready watchers without emulator mode.
4. Cross-role E2E using two independent browser contexts and the same backend order.
5. Transient network test: fail one detail read, recover network, verify the watcher resumes and both roles converge.
6. Mutation contract test for `take`: resolved HTTP-200 business error must not be treated as successful mutation unless the API contract explicitly defines it as success.

## Files reviewed

- `src/state/orders/sagas.ts`
- `src/state/orders/actionCreators.ts`
- `src/state/orders/reducer.ts`
- `src/state/orders/selectors.ts`
- `src/pages/Passenger/index.tsx`
- `src/pages/Driver/index.tsx`
- `src/pages/Driver/Map.tsx`
- `src/pages/Order/index.tsx`
- `src/components/modals/CardModal.tsx`
- `src/platform/adapters/DriverMapGateway.ts`
- `src/platform/adapters/LegacyBackendGateway.ts`
- `e2e/TEST-E2E-009-recon.md`
- `docs/migration/REPOSITORY_MERGE_REPORT.md`

## Limitations

- No live two-device test was run in this stage.
- No new Jest, TypeScript, build or Playwright execution was possible through the repository connector.
- Production feature-flag values and actual deployed driver watcher behavior remain unverified.
- Backend ordering, response consistency and persistence guarantees cannot be inferred from frontend source.
- Findings are based on the pinned source commit, not on an unprovided QA worktree or a newer branch.
