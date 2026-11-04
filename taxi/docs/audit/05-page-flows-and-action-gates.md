# 05. Page-level flows, action gating and modal behavior

## 1. Evidence baseline

**Repository:** `Guseyn9/taxi`  
**Branch:** `main`  
**Commit:** `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`

Reviewed:
- `pages/Driver/Map.tsx`, `pages/Driver/index.tsx`, `pages/Order/index.tsx`
- `components/MiniOrders/index.tsx`, `components/modals/CardModal.tsx`
- `components/modals/CancelModal.tsx`, `PassengerSosModal.tsx`
- `DriverTripCancelModal.tsx`, `RatingModal.tsx`

Source inspection only. No tests were executed; backend and deployed runtime behavior remain unverified. Findings are not yet confirmed for the intended pilot branch.

## 2. Driver map: lifecycle and action gates

The map derives an effective driver state and chooses a primary action:
- `Performer` → depart, calling `driverMapGateway.arrive`;
- `Arrived` → start, calling `driverMapGateway.start`; voting orders open the card for boarding-code confirmation;
- `Started` → finish at destination, calling `driverMapGateway.finish`.

Pickup and destination actions are gated using `requiresPickupArrival` and `requiresDestinationArrival`. The map also uses `mapActionPending` to prevent repeated lifecycle actions.

### FLOW-01 — Map finish failure is swallowed and UI proceeds

In `onCompleteOrderClick`, rejection from `driverMapGateway.finish` is only sent to `console.error`. The `finally` block refreshes order state, clears pending state and, when the trip plan has no other stops, navigates away from the map. No user-visible failure is shown.

**Priority: high.** A failed finish request can look completed to the driver, who may leave the screen without knowing the backend did not close the trip.

**Recommendation:** handle rejection separately, show a recoverable error and keep/reconcile the active order. Navigate only after confirmed completion or a refresh proves the backend state is Finished.

### FLOW-02 — Position gates are client-side

Pickup/destination gates use the current effective driver position and reachability logic. They improve UX but cannot replace backend transition validation. GPS may be stale, unavailable or inaccurate; the server must independently enforce valid state transitions and any geofence policy.

**Acceptance tests:** stale GPS, denied permission, outlier jump, exact radius boundary and server rejection despite client-side eligibility.

### FLOW-03 — Multi-stop completion has distinct semantics

The map distinguishes intermediate from final stops. Completing one order may preserve the trip plan and keep the driver on the map for remaining passengers. Test two or more passengers, completion of one while another remains Started, and the final stop after the first order is removed.

## 3. Driver order card and mini-order card

`CardModal` reads the selected order from the orders store, subscribes while active, and derives the driver's state from the order's driver list. Mutating buttons are disabled using `ordersSelectors.orderMutates(orderId)`. Voting boarding/navigation actions add gates for boarding pending, pickup reachability and coordinate availability.

### FLOW-04 — Overlapping lifecycle flows across surfaces

The detailed `pages/Order` screen, map primary action and `CardModal` each contain lifecycle handlers. They route through `driverMapGateway`, but maintain different local state, navigation and success/error presentation. A fix to one surface may not be reflected in the others.

**Recommendation:** keep `driverMapGateway` as the shared command boundary and add shared scenario tests exercising the same transition from every supported surface.

### FLOW-05 — Mutation locks are not visibly global

`CardModal` uses the per-order `orderMutates` selector; the map uses `mapActionPending`; the detailed order page has local pending refs/state for selected flows. These guards are not visibly one global lock across all surfaces.

**Acceptance test:** open the same order in two surfaces/tabs and trigger the same action quickly; verify that the backend accepts only one transition and all surfaces reconcile to the same state.

## 4. Passenger cancellation and SOS

### 4.1 Standard cancellation

`CancelModal` loads configured reasons, defaults to the first reason, sends the selected reason through `ordersActionCreators.cancel`, refreshes active orders and clears the selected order after success. It prevents a second confirmation while submitting.

### FLOW-06 — Standard cancel modal can close during an in-flight request

The confirm button is disabled during submission, but the overlay close handler directly calls `setCancelModal(false)` without checking `isSubmitting`. The request continues asynchronously while the user can close the modal and potentially initiate another interaction before the first result is reconciled.

**Priority: low/medium.** Decide whether dismissal during submission is allowed. If not, guard the overlay and cancel button as the driver-trip and SOS modals do.

### 4.2 SOS

`PassengerSosModal` resets selected reason and submitting state on open, requires an explicit reason, disables confirmation until a reason is selected, and calls `submitPassengerSos`. On success it closes modals, clears the selected order and refreshes active orders. On failure it leaves the SOS modal available and displays an error.

A unit test exists for `submitPassengerSos` and an E2E spec exists. The E2E README says the exact post-Started scenario is covered at unit level because reproducing it through the UI was not reliable.

**Disposition:** retain end-to-end coverage for the full SOS path when the environment can reliably create the required Started state.

## 5. Driver trip interruption

`DriverTripCancelModal` resets reason and submitting state on open, blocks closing while submitting, and sends the selected reason through `runDriverSelfCancellation` and `driverMapGateway.cancel`. On failure it clears submitting state and displays an error.

**Acceptance test:** reason is persisted server-side, failure clears the optimistic driver-cancel marker, and the order remains active/actionable after rejection.

## 6. Rating modal

The rating modal resets stars, tips and comment on open. It requires at least one star before enabling the rate button. However, the submit handler calls only `backendGateway.setOrderRating(orderId, stars)`; entered tips and comment are not included in the request. The source also contains a TODO to connect the rating fields to the API.

### FLOW-07 — Tips and comment are collected but not submitted

**Priority: medium / product-contract dependent.** The user can enter tips and a comment, but the inspected handler sends only the star value. These fields are currently cosmetic from the API's perspective.

**Recommendation:** wire them to a supported backend contract or remove/disable them until supported. Do not imply that a tip or comment was saved.

### FLOW-08 — Rating modal closes before the request succeeds

The handler starts `setOrderRating(...)`, attaches a catch that only logs the error and emits a flow event, then immediately closes the modal. The user receives no visible failure and cannot retry from the same screen.

**Priority: high.** A failed rating submission is indistinguishable from a successful one in the normal UI.

**Recommendation:** await the request, keep the modal open on failure, show a retryable message and close only after a confirmed response. Verify whether backend error response bodies are normalized/rejected by the gateway.

## 7. Coverage discovered

Repository search identified:
- lifecycle E2E: `standard-order.spec.ts`, `trip-finish.spec.ts`, `trip-interruption.spec.ts`, `driver-boarding.spec.ts`, `voting-order.spec.ts`;
- passenger cancellation/SOS: `standard-order-cancel-before-assignment.spec.ts`, `offer-passenger-cancel.spec.ts`, `passenger-sos.spec.ts`;
- unit test: `src/tools/__tests__/passengerSos.test.js`.

Test-file presence is not a passing test result. Search did not establish direct component tests for RatingModal, CancelModal, DriverTripCancelModal or the Map finish failure path. Verify the complete test tree before concluding no such tests exist.

## 8. Priority and disposition

| ID | Priority | Required action |
|---|---|---|
| FLOW-01 | High | Show recoverable error when map finish fails |
| FLOW-08 | High | Await rating API result; expose retry on failure |
| FLOW-07 | Medium | Send tips/comment or remove unsupported fields |
| FLOW-05 | Medium | Test cross-surface duplicate action and backend idempotency |
| FLOW-02 | Acceptance verification | Verify backend transition/geofence validation |
| FLOW-03 | Acceptance verification | Test multi-stop trip semantics |
| FLOW-04 | Medium | Contract-test duplicated lifecycle UI paths |
| FLOW-06 | Low/medium | Decide whether cancel modal can close during submission |

## 9. Next audit step

Proceed to state ownership and event flow:
1. Redux reducers/selectors and Saga subscriptions for active/ready/history lists and detailed order.
2. Optimistic local state, localStorage projections and browser events.
3. Reconciliation after mutation, reconnect, reload and multi-tab usage.
4. Duplicate/stale sources of truth between Redux, Platform Interface snapshots, gateway events and local UI state.
