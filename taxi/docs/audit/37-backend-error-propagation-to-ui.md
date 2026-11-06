# 37. Backend error propagation to passenger and driver UI

## Scope and baseline
- Repository: Guseyn9/taxi
- Source baseline: main at 8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf
- Audit branch: audit/frontend-inventory
- Method: static source tracing. No application source changed. No tests executed.

## Executive result
The Gateway has a common backend response validator, but UI handlers do not consistently preserve and display mutation outcomes. Four important paths were found: Driver Map Finish navigates away after a failed command; Driver Order Start has no local rejection handler; RatingModal closes before the server confirms submission; along-the-way progression suppresses Arrive and Start failures and continues.

## Findings

### UI-37-01 — Driver Map Finish treats rejection as completion for navigation
File: src/pages/Driver/Map.tsx, handler containing driverMapGateway.finish(order.b_id).
Observed sequence: before sending Finish, the handler deletes optimistic demo state, clears local boarded state and sets pending. It then catches rejection only with console.error and runs finally regardless. The finally block clears pending, refreshes the order, removes stored Voting-start state and navigates to Driver Orders when the plan does not continue.
Therefore the UI does not distinguish confirmed finish from failed finish. It navigates away and shows no failure message. Local state was already cleared before the command outcome.
Severity: Critical / P0. Recommendation: only clear terminal local state and navigate after confirmed completion or authoritative readback. On rejection/timeout, retain order context, show failure/unknown outcome and read back state before retry.

### UI-37-02 — Driver Order Start rejection has no local error path
File: src/pages/Order/index.tsx, onStartedClick.
Observed: driverMapGateway.start(id).then(...) refreshes and navigates on success; no catch is attached. In the same file, Arrive and Finish handlers do attach catches and show MessageModal.
Severity: High. Recommendation: add visible rejection handling, preserve the screen and refresh order state after ambiguous timeout.

### UI-37-03 — Rating modal closes before submission result
File: src/components/modals/RatingModal.tsx, onRating.
Observed: backendGateway.setOrderRating(...).catch(...) only writes a flow failure event and console log. setRatingModal({ isOpen: false }) runs immediately after starting the request, not after success. No user-facing error appears and the form cannot be retried from the open modal.
Severity: High. Recommendation: await mutation; disable submit while pending; close only after validated success; retain the form and show an actionable error on failure.

### UI-37-04 — Along-the-way progression suppresses lifecycle failures
File: src/pages/Driver/Map.tsx, takeAlongTheWayOrder.
Observed: after takeOrder resolves, the UI marks passenger boarded. It then awaits Arrive and Start, but each rejection is caught only by console.error; execution proceeds to refreshMapOrderState and timeout/progression logic. The source comment says this tolerates noisy demo-backend responses. Gateway/command paths otherwise validate responses and completion.
Severity: High, environment-dependent. Recommendation: restrict this tolerance to a proven emulator/demo mode. For real drivers, stop progression on failed transition, read authoritative state and do not mark boarded before confirmation.

### UI-37-05 — MessageModal is a singleton, not a queue
Files: src/state/modals/reducer.ts and src/components/modals/MessageModal.tsx.
Observed: Redux holds one messageModal object; SET_MESSAGE_MODAL replaces it. There is no queue, operation ID, order ID or deduplication. Closely spaced async outcomes can overwrite one another. This is an architectural race risk, not proof of a production occurrence.
Severity: Medium. Recommendation: either queue messages or make operation screens own their pending outcomes; add correlation to prevent replacement races.

## Cancellation recovery
Passenger CancelModal: on rejection logs and opens a generic Fail MessageModal; finally resets isSubmitting. It does not close the cancellation modal, so the passenger can retry. Backend reason details are discarded.
DriverTripCancelModal: runDriverSelfCancellation places a local mark before request and clears it if the command rejects. The modal remains open, submitting resets and a generic failure is shown. This rollback is safer than Driver Map Finish, but ambiguous timeout is not followed by explicit readback.

## Shared error handling
LegacyBackendGateway validates resolved envelopes and normalizes errors. DriverMapGateway legacy lifecycle handling validates response envelopes and publishes a correlated Failed event. Configured FSM lifecycle waits for command completion, not just acceptance. However, UI handlers inconsistently convert normalized failures into visible and recoverable outcomes.
apiMessages.ts maps known backend phrases to translations, otherwise uses generic text plus original code/message. Other screens use generic ERROR, raw error.toString(), or console-only logging. Localization and diagnostic detail are inconsistent.

## Evidence classification
| Statement | Classification |
|---|---|
| Map Finish catches only to console and navigates in finally | Observed in source |
| Driver Order Start has no local catch | Observed in source |
| Rating modal closes immediately and logs rejection only | Observed in source |
| Along-the-way Arrive/Start failures are swallowed independently | Observed in source |
| Passenger cancel remains retryable on rejection | Observed in source |
| Driver trip cancel clears optimistic mark on rejection | Observed in source |
| MessageModal is one Redux slot | Observed in source |
| These defects reproduce in Morocco production | Unverified |
| Runtime timeout/response timing | Unverified |
| Jest/E2E coverage | Not tested in this stage |

## Remediation order
1. P0: fix Map Finish; no terminal cleanup/navigation before confirmed completion or authoritative readback.
2. P0: stop along-the-way progression on real Arrive/Start failures; do not mark boarded before confirmation.
3. P1: add Start rejection handling and readback.
4. P1: await Rating submission and retain form on failure.
5. P1: standardize localized mutation errors with safe diagnostic code, operation/order context and retry/readback policy.
6. P2: decide queue vs screen-owned outcomes for MessageModal and add correlation.
7. Add failure/timeout tests, including server-side success with lost response.

## Pilot disposition
NO-GO for driver lifecycle UI acceptance until UI-37-01 and UI-37-04 are fixed and covered by failure-path tests. UI-37-02 and UI-37-03 should be fixed before wider pilot exposure.
No source files, workflows, fixtures or runtime configuration were changed. No Jest, TypeScript, build or E2E execution was performed.

## Evidence links
- [Driver Map](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/pages/Driver/Map.tsx)
- [Driver Order page](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/pages/Order/index.tsx)
- [RatingModal](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/components/modals/RatingModal.tsx)
- [Passenger CancelModal](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/components/modals/CancelModal.tsx)
- [DriverTripCancelModal](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/components/modals/DriverTripCancelModal.tsx)
- [driverSelfCancel.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/driverSelfCancel.ts)
- [DriverMapGateway](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/DriverMapGateway.ts)
- [LegacyBackendGateway](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyBackendGateway.ts)
- [backendError.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/backendError.ts)
- [MessageModal](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/components/modals/MessageModal.tsx)
- [API error messages](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/apiMessages.ts)