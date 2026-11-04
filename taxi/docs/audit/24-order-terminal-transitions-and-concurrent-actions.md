# Stage 24 — Order terminal transitions and concurrent actions

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: cancel/finish/interruption commands, duplicate clicks, concurrent actions from Passenger and Driver, terminal-state handling, retries and E2E coverage.
- Findings are source-level unless explicitly identified as tested by an existing test.
- No application source changed.

## Executive result

The repository now contains dedicated live-backend E2E scenarios for normal trip completion (TEST-E2E-010) and driver interruption (TEST-E2E-011). These are meaningful additions: they drive the lifecycle through the Driver UI and independently read backend state. They do not, however, test concurrent Passenger/Driver commands, duplicate clicks, command timeout followed by retry, or conflicting terminal actions.

Protection against repeated actions is inconsistent:
- Driver Map uses a page-level `mapActionPending` guard for map transitions.
- Driver CardModal uses a shared local mutation wrapper, but it is component-local.
- PassengerLiveOrder guards its finish handler with `isFinishing`.
- Passenger OnTheWayModal has no equivalent in-flight guard.
- DriverCancelModal starts cancellation asynchronously, navigates away and closes immediately, without awaiting or displaying failure.
- DriverTripCancelModal has a better submitting lock and awaits the command, but it remains a separate path.

Frontend guards improve interaction behavior but cannot guarantee atomicity when two devices issue commands. The backend must enforce legal state transitions and idempotency.

## Observed behavior

### 1. Driver finish and interruption

`DriverMapGateway.finish(orderId)` and `cancel(orderId, reason)` dispatch lifecycle actions. In the legacy handler, finish calls `setOrderState(Finished)`; cancel calls `cancelDrive(orderId, reason)`. In the configured command-transport path, these actions are sent through the FSM Command API and the UI waits for a terminal completion result before publishing success.

Driver Map:
- blocks its primary action while `mapActionPending`;
- sets that flag before finish;
- sends finish;
- refreshes detail and active list immediately and after 1.5 seconds in `finally`;
- navigates away after finish even if the command promise rejects (the rejection is logged in the current handler).

The latter behavior means a failed finish can still close the map context. The refresh is useful reconciliation, but the UI does not preserve a dedicated failed-finish retry context.

Driver interruption is opened through a reason modal. `DriverTripCancelModal` uses `isSubmitting`, prevents dismissal while submitting, calls `runDriverSelfCancellation`, awaits the Gateway promise, displays success and navigates on success, or displays an error and re-enables the form on failure. The local self-cancel marker is rolled back when the command rejects.

### 2. Driver cancellation of an assigned, not-yet-started order

`DriverCancelModal` is a separate implementation:
1. marks the order as self-cancelled;
2. calls `passengerGateway.cancelOrder(orderId)`;
3. attaches a rejection handler that logs and clears the marker;
4. navigates to the Driver Orders page immediately;
5. closes the modal immediately.

There is no submitting state, no disabled confirmation button, no awaited completion, no success/failure message and no explicit list/detail refresh in this component. A second click can initiate another request before the modal closes. If the request fails, the user has already been navigated away and only a console error/marker cleanup occurs.

This is distinct from the better-controlled in-trip interruption modal and must not be treated as the same flow.

### 3. Passenger cancellation

Passenger `CancelModal` has an `isSubmitting` guard and disables the confirm button. On successful cancellation it refreshes active orders, clears selected order and closes the related modals. On failure it shows a generic error and re-enables submission in `finally`. The Overlay itself can still be dismissed by clicking outside while the request is in flight; the request continues in the background.

### 4. Passenger finish paths are not uniform

There are multiple Passenger completion entry points:

- `PassengerLiveOrder.handleFinishClick`: uses `isFinishing` to suppress repeated clicks, calls `passengerGateway.completeRide`, refreshes active orders and opens rating on success; shows an error on failure; resets the guard in `finally`.
- `VotingForm`: has a finishing state and performs the same command/read-refresh/rating sequence; separate component-local lock.
- `OnTheWayModal.handleCloseDriveClick`: calls `passengerGateway.completeRide`, opens rating on success and shows an error on failure, but has no in-flight guard, no pending UI state and no refresh of active orders in the shown handler. The modal Overlay can be dismissed while the request runs.

The three entry points can therefore behave differently for duplicate clicks, list reconciliation and modal dismissal. Their component-local locks do not coordinate with one another or with another device.

### 5. Backend response semantics and idempotency

`LegacyPassengerGateway.completeRide` calls `setOrderState(orderId, Finished)`. The Gateway reports command completion when the API promise resolves; source review does not establish that every legacy API HTTP-200 business response is semantically successful unless the underlying API wrapper validates it. The DriverMap Gateway explicitly calls `assertSuccessfulBackendResponse` for lifecycle methods; the Passenger Gateway's `CompleteRide` handler returns the raw `setOrderState` result.

A second terminal command can race with the first, or a retry can arrive after the backend applied the first command but the client lost its response. The frontend cannot determine whether retrying a non-idempotent legacy mutation is safe. That contract must be defined and enforced server-side.

## Findings

### TERM-24-01 — Driver assigned-order cancellation navigates away before the command resolves

**Severity: High**

**Observed:** `DriverCancelModal.onCancel` fires `passengerGateway.cancelOrder` without awaiting it, navigates immediately and closes the modal. Failure only logs and clears the self-cancel marker.

**Impact:** The user can be shown as having left the order while the backend has not cancelled it. A network or business failure has no visible recovery path. Repeated confirmation can send overlapping requests.

**Recommendation:** Convert the handler to an awaited async operation; add an in-flight lock and disabled button; keep the modal open until terminal result; on success refresh order/list and navigate; on failure preserve context, clear the marker and show a retryable error.

### TERM-24-02 — Passenger OnTheWayModal allows duplicate completion commands

**Severity: High**

**Observed:** `handleCloseDriveClick` has no pending flag or duplicate-call guard. The button remains enabled during the request. The modal can also be dismissed by the Overlay while the request is in flight.

**Impact:** Rapid repeated taps can send multiple Finished commands. The UI can disappear before the outcome is known. Unlike PassengerLiveOrder and VotingForm, this path does not explicitly refresh active orders in the handler.

**Recommendation:** Use a pending state/ref guard, disable the finish button and outside dismissal while pending, then refresh the active order collection and only open rating after a verified successful response. Consider sharing one finish-command hook across Passenger surfaces.

### TERM-24-03 — Passenger completion has three independently guarded entry points

**Severity: Medium**

**Observed:** PassengerLiveOrder, VotingForm and OnTheWayModal each call `completeRide` but have different local pending, refresh and modal behavior.

**Impact:** One surface can submit while another is already submitting; cross-component and cross-device duplicate suppression is absent. Reconciliation and error behavior can diverge.

**Recommendation:** Centralize the Passenger finish operation in a shared command service/hook keyed by order ID. The backend must still provide atomic state validation and idempotency; a shared frontend lock is only a usability safeguard.

### TERM-24-04 — Driver Map closes the context after failed finish

**Severity: Medium**

**Observed:** Driver Map catches finish rejection only to log it, then the `finally` block refreshes and navigates to the orders list when the trip plan has no remaining stops. This happens after both success and failure.

**Impact:** A failed or timed-out finish can remove the driver's immediate retry context. Refresh requests may later show the order as still Started, but the driver has already left the map.

**Recommendation:** Navigate and clear terminal map state only after a confirmed terminal readback/completion. On failure, refresh the order, restore/retain the active action and show a retryable error. If the command result is ambiguous due to timeout, read backend state before offering a retry.

### TERM-24-05 — Passenger completion Gateway does not visibly validate business-level success

**Severity: Medium; verify API wrapper contract**

**Observed:** Passenger Gateway resolves `CompleteRide` with the raw result of `backendGateway.setOrderState`. DriverMap lifecycle handler wraps state changes with `assertSuccessfulBackendResponse`. The Passenger completion path has no equivalent assertion in the adapter.

**Impact:** If the legacy method resolves HTTP 200 with a business-level error object, Passenger UI may treat it as completed and open rating even though the state did not change.

**Recommendation:** Apply one shared response validator to both Passenger and Driver lifecycle commands, based on the actual API response contract. Add a test where a resolved business-error response must reject the command.

### TERM-24-06 — No concurrent terminal-command E2E proof

**Severity: High for production lifecycle assurance**

**Observed:** TEST-E2E-010 proves one normal Driver UI finish path with independent backend readback. TEST-E2E-011 proves one Driver UI interruption path with a selected reason and backend readback. The reviewed scenarios do not create simultaneous Passenger finish + Driver finish, Passenger cancel + Driver finish, two rapid clicks, or retry after ambiguous timeout.

**Impact:** Existing green lifecycle scenarios do not prove that competing commands cannot produce inconsistent terminal states or duplicate side effects.

**Recommendation:** Add controlled two-context tests:
1. Driver finish and Passenger finish started concurrently for the same Started order.
2. Passenger cancel and Driver finish started concurrently.
3. Two rapid clicks on each UI finish/cancel action.
4. Backend applies command but response is dropped; client reads state before retry.
5. Same command/idempotency key replay versus a distinct conflicting command.
Assert exactly one legal terminal state, no duplicate side effects, consistent readback for both roles, and clear UI behavior for the losing command.

## Lifecycle and race matrix

| Competing operations | Frontend protection observed | Backend guarantee needed | Evidence status |
|---|---|---|---|
| Driver finish vs Driver finish | Driver Map page lock | Atomic Started → Finished transition; duplicate semantics | Single-click E2E only |
| Passenger finish vs Passenger finish, LiveOrder | Component-local `isFinishing` | Idempotent finish | No duplicate-click E2E |
| Passenger finish via OnTheWayModal | No local lock | Idempotent finish | No duplicate-click E2E |
| Passenger finish vs Driver finish | Separate UI locks | One terminal transition wins; deterministic conflict response | Not tested |
| Passenger cancel vs Driver finish | Separate mutation paths | Explicit terminal-state precedence/serialization | Not tested |
| Driver assigned-order cancel vs repeat click | No lock in DriverCancelModal | Idempotent cancel | Not tested |
| Driver in-trip cancel vs repeat click | Modal `isSubmitting` | Idempotent cancel with reason | Single-click E2E only |
| Finish response timeout after backend commit | UI refresh varies by entry point | Read-after-ambiguous-result; idempotency key | Not tested |

## Existing tests and their limits

- `src/platform/adapters/__tests__/DriverMapGateway.test.js`: checks Driver Gateway success/failure event behavior, cancellation routing and configured Command API completion. These are adapter-level tests, not competing-command integration tests.
- `src/platform/adapters/__tests__/LegacyPassengerGateway.test.js`: checks Passenger Gateway mapping, including CompleteRide → Finished state command. It does not establish backend business-error handling or cross-role races.
- `e2e/trip-finish.spec.ts` (TEST-E2E-010): live Driver UI path through Performer → Arrived → Started → Finished, with backend readback.
- `e2e/trip-interruption.spec.ts` (TEST-E2E-011): live Driver UI path through Started → Canceled with reason and backend readback.
- Stage 20 findings remain relevant to rating after finish: rating submission itself closes early and lacks durable acknowledgement.

The source files and test definitions exist on the pinned commit. This stage did not execute them.

## Files reviewed

- `src/platform/adapters/DriverMapGateway.ts`
- `src/platform/adapters/LegacyPassengerGateway.ts`
- `src/components/modals/CancelModal.tsx`
- `src/components/modals/DriverCancelModal.tsx`
- `src/components/modals/DriverTripCancelModal.tsx`
- `src/components/modals/OnTheWayModal.tsx`
- `src/components/modals/CardModal.tsx`
- `src/components/PassengerLiveOrder/index.tsx`
- `src/pages/Passenger/VotingForm.tsx`
- `src/pages/Driver/Map.tsx`
- `src/tools/driverSelfCancel.ts`
- `e2e/trip-finish.spec.ts`
- `e2e/trip-interruption.spec.ts`
- `src/platform/adapters/__tests__/DriverMapGateway.test.js`
- `src/platform/adapters/__tests__/LegacyPassengerGateway.test.js`

## Limitations

- No new Jest, TypeScript, build or Playwright execution was performed in this stage.
- No live concurrent two-device command race was run.
- The backend's transaction isolation, terminal-state transition rules and idempotency behavior remain unverified.
- No assumption is made that a timeout means a command was not applied.
- All source conclusions refer to the pinned `main` commit above.
