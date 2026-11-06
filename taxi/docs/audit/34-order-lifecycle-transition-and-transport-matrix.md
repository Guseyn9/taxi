# 34. Order lifecycle transition and transport matrix

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: consolidate the three order modes' driver-state progression and identify which lifecycle mutations use Legacy API versus FSM Command transport.
- This stage synthesizes source and existing E2E specifications. No backend implementation, live API, pilot tenant configuration, or new test execution was available. No application source changed.

## Executive result

The frontend has a shared set of driver lifecycle states, but not one unified transport for all roles:

- Driver Map lifecycle actions (Arrive, Start, ConfirmBoarding, Finish, Cancel) use FSM Command transport only when `REACT_APP_FSM_API_URL` is configured; otherwise they execute through the legacy API adapter.
- Passenger mutations, including cancellation and completion, still execute through `LegacyPassengerGateway` and the legacy Taxi API.
- Order-mode differences are concentrated around candidate selection and the Arrived → Started step: Standard starts directly, Voting requires the boarding-code screen, and Offer starts directly without the Voting code gate.
- The frontend does not define or enforce the authoritative server-side state-transition graph. It sends commands and interprets responses/snapshots. Backend legal transitions, authorization and atomicity remain server contract requirements.

## 1. Shared state vocabulary

Observed in `src/types/types.ts`:

| Domain | State | Value |
|---|---|---:|
| Booking | Processing | 1 |
| Booking | Approved | 2 |
| Booking | Canceled | 3 |
| Booking | Completed | 4 |
| Booking | PendingActivation | 5 |
| Booking | OfferedToDrivers | 6 |
| Driver participation | Considering | 1 |
| Driver participation | Canceled | 2 |
| Driver participation | Performer | 3 |
| Driver participation | Arrived | 4 |
| Driver participation | Started | 5 |
| Driver participation | Finished | 6 |

These are frontend enum values. They do not, by themselves, prove the backend accepts every transition from every current state.

## 2. Mode progression observed in source and E2E definitions

| Stage | Standard | Voting | Offer |
|---|---|---|---|
| Driver response | Direct take is expected to make the driver Performer | Driver becomes a candidate (Considering); passenger selects | Driver submits offer/candidate response; passenger selects |
| After selection | Performer | Performer | Performer |
| Performer → Arrived | Driver Map Arrive action | Driver Map Arrive action; legacy branch also calls `arrivedVotingOrder` | Driver Map Arrive action |
| Arrived → Started | Direct Start; no boarding form | Confirm Boarding through order card and code path | Direct Start; no boarding form |
| Started → terminal | Driver Finish or passenger CompleteRide | Driver Finish or passenger CompleteRide; passenger SOS is a separate cancellation path | Driver Finish or passenger CompleteRide |

Evidence:
- `e2e/README.md` documents TEST-E2E-002 Standard, TEST-E2E-003 Voting, TEST-E2E-004 Offer, TEST-E2E-007 SOS, TEST-E2E-009 Standard passenger-to-driver flow, TEST-E2E-010 finish and TEST-E2E-011 interruption.
- `src/pages/Driver/Map.tsx` gates the code-confirmation branch on `isVotingOrder(order)`; other orders use direct Start.
- `src/tools/driverOffer.ts` treats Voting and Offer as distinct choice flows.
- The documented Offer E2E explicitly checks that no boarding form is shown and the driver proceeds from Arrived by direct action.

Important qualification: the E2E suite's documented live backend is `gruzvill`; it is not evidence that the Morocco pilot tenant has the same configuration or server-side state rules.

## 3. Lifecycle transport ownership

| Operation | Frontend entry point | Transport in current source | FSM availability |
|---|---|---|---|
| Driver Arrive | `driverMapGateway.arrive` | DriverMapGateway legacy handler → `setOrderState(Arrived)`; Voting additionally calls `arrivedVotingOrder` | Yes, when FSM command URL configured |
| Driver Start | `driverMapGateway.start` | Legacy handler → `setOrderState(Started)` | Yes |
| Voting boarding confirmation | `driverMapGateway.confirmBoarding` | Legacy handler → `confirmVotingCode` then `setOrderState(Started, code)` | Yes, sends `boardingCode` |
| Driver Finish | `driverMapGateway.finish` | Legacy handler → `setOrderState(Finished)` | Yes |
| Driver in-trip Cancel | `driverMapGateway.cancel` | Legacy handler → `cancelDrive(orderId, reason)` | Yes; intent maps to `cancel_requested` |
| Passenger cancel | `passengerGateway.cancelOrder` | LegacyPassengerGateway → `cancelDrive` | No FSM route in this adapter |
| Passenger finish | `passengerGateway.completeRide` | LegacyPassengerGateway → `setOrderState(Finished)` | No FSM route in this adapter |
| Driver assigned-order cancel modal | `passengerGateway.cancelOrder` | LegacyPassengerGateway → `cancelDrive` | No FSM route in this adapter |

This is a dual-transport deployment boundary, not a completed migration. A configured Driver FSM endpoint does not move Passenger cancellation/completion onto FSM.

The FSM branch is selected by `REACT_APP_FSM_API_URL` for DriverMap lifecycle commands. Command completion is then resolved by Command Status only when the status transport is configured/enabled; otherwise the configured completion waiter can use snapshot inference. The effective pilot environment was not inspected.

## 4. Contract findings

### LIFE-34-01 — No single role-independent lifecycle command boundary

**Severity: High**

Passenger Finish/Cancel and Driver Map Finish/Cancel can target the same order through different adapters and transports. The same terminal state may therefore be requested by:
- Driver FSM Command API;
- Driver legacy API;
- Passenger legacy API.

The frontend has no common cross-role idempotency key or shared pending-command record. Component locks are local to individual UI surfaces. Backend state validation and idempotency must be authoritative.

### LIFE-34-02 — Mode-specific Arrived → Started semantics are distributed across UI branches

**Severity: Medium**

The code gate is determined by `isVotingOrder` at Driver Map and order-card level. Offer is intentionally excluded from that gate. A stale or incorrectly classified mode can therefore change the action path from direct Start to code confirmation or vice versa. Stage 32 separately records the observed Offer marker degradation and the missing server-side boarding-code validation.

Add a mode/transition contract test that starts from backend snapshots for Standard, Voting and Offer and verifies both the selected command and resulting server state.

### LIFE-34-03 — Passenger lifecycle mutations remain Legacy-only

**Severity: High for FSM rollout scope**

`LegacyPassengerGateway` directly maps CreateOrder, CancelOrder, SelectCandidate, ReleaseCandidate, UpdateWaitingTime, UpdateCustomerPrice and CompleteRide to legacy API calls. Driver FSM enablement does not imply Passenger FSM migration. Pilot acceptance must explicitly approve this mixed architecture and verify backend authorization for each legacy passenger mutation.

### LIFE-34-04 — Successful promise resolution is not a universal terminal-state proof

**Severity: High**

Driver legacy lifecycle handlers call `assertSuccessfulBackendResponse`; Passenger Gateway publishes CommandCompleted with the raw API result. Whether the underlying API method rejects every HTTP-200 business failure differs by endpoint and must be checked per operation. A resolved Passenger promise cannot be treated as proof of Finished/Canceled without readback where response semantics are not contractually strict.

This complements, rather than replaces, stage 24's specific Passenger finish/cancel UI findings and stage 25's ambiguous timeout recovery findings.

## 5. Existing E2E coverage versus missing acceptance evidence

| Scenario | Existing specification | Evidence boundary |
|---|---|---|
| Standard: create/order visibility/take/Arrive/Start | TEST-E2E-002 and TEST-E2E-009 | Live gruzvill backend; independent state readback documented |
| Voting: candidate selection and boarding | TEST-E2E-001 and TEST-E2E-003 | Boarding negative test rejects malformed format locally; server wrong-code enforcement is not established |
| Offer: two driver offers and passenger selection | TEST-E2E-004 | Live gruzvill flow documented; does not establish Morocco tenant marker stability |
| Offer: selected driver declines | TEST-E2E-005 | Separate driver-decline scenario |
| Offer: passenger cancellation | TEST-E2E-006 | Passenger cancellation scenario |
| Standard: cancellation before assignment | TEST-E2E-012 | UI-created order and passenger cancellation |
| Driver finish | TEST-E2E-010 | Started → Finished with backend readback |
| Driver interruption | TEST-E2E-011 | Started → Canceled with backend readback |
| Concurrent Passenger/Driver terminal commands | No identified E2E | Missing |
| Duplicate Passenger Finish across separate UI surfaces/devices | No identified E2E | Missing |
| Same command replay after lost response/timeout | No identified E2E | Missing |
| Cross-transport race: Passenger Legacy Finish vs Driver FSM Finish | No identified E2E | Missing |
| FSM/Legacy parity for every mode and terminal action | No complete matrix test identified | Missing |

Existing tests should not be described as newly executed in this stage. Stage 31's run #178 was an E2E run with 19 passed and 2 flaky; it does not establish the complete scenario matrix above or a no-retry stability pass.

## 6. Required backend acceptance contract

Before pilot sign-off, backend owners must provide and verify:
1. A state-transition table keyed by current booking state, driver participation state, actor role and order mode.
2. Server authorization for every transition, including the appointed driver and passenger/order ownership.
3. Atomic handling of concurrent Finish/Cancel/Start commands across Passenger Legacy and Driver FSM/Legacy transports.
4. Idempotent replay semantics for repeated commands and a documented terminal-state response.
5. A read-after-ambiguous-timeout procedure that resolves whether the command executed before the UI permits a retry.
6. A versioned transport contract stating which passenger and driver mutations remain Legacy for the pilot.
7. Tenant-backed tests for Standard, Voting and Offer, including negative illegal transitions and cross-role races.

## 7. Pilot disposition

- **Mode progression:** frontend paths are identifiable and have meaningful historical E2E coverage on gruzvill; Morocco tenant parity is unverified.
- **Terminal transitions:** not closed. Cross-role concurrency and idempotency remain backend acceptance gates.
- **FSM migration:** partial. Driver Map lifecycle can use FSM; Passenger lifecycle mutations remain Legacy.
- **Overall lifecycle readiness:** NO-GO until the server transition/idempotency contract and target-tenant cross-role tests are evidenced.

## Evidence links

- [DriverMapGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/DriverMapGateway.ts)
- [LegacyPassengerGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/LegacyPassengerGateway.ts)
- [FsmTaxiCommandTransport.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/FsmTaxiCommandTransport.ts)
- [DriverCommandCompletionWaiter.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/DriverCommandCompletionWaiter.ts)
- [types.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/types/types.ts)
- [E2E README](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/README.md)
- [Stage 24](./24-order-terminal-transitions-and-concurrent-actions.md)
- [Stage 25](./25-api-failures-timeouts-and-recovery.md)

