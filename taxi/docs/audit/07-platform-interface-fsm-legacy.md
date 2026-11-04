# 07. Platform Interface, FSM transports and legacy adapters

## 1. Evidence baseline

**Repository:** `Guseyn9/taxi`  
**Branch:** `main`  
**Commit:** `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`

Reviewed source:
- `App.tsx`
- `platform/platform-interface/{compositionRoot,PlatformInterfaceRuntime,SnapshotProvider}.ts`
- `platform/platform-interface/surfaces/{passenger,map,standard}`
- `platform/adapters/{DriverMapGateway,LegacyBackendGateway,LegacyPassengerGateway,LegacyReduxSnapshotProvider,LegacyPassengerChannelStoreAdapter}.ts`
- `platform/adapters/{FsmTaxiCommandTransport,FsmCommandStatusTransport,FsmDriverSnapshotTransport,FsmOrderSnapshotTransport,DriverCommandCompletionWaiter}.ts`
- related adapter and runtime tests, and repository migration documentation.

This is source inspection only. No test suites or live endpoints were executed. Findings apply to the pinned `main`, not yet confirmed against the pilot integration branch.

## 2. Runtime/provider selection

At module initialization, `App.tsx` creates:
- `legacySnapshotProvider` backed by Redux;
- `serverOrderSnapshotProvider` from `REACT_APP_FSM_API_URL` + `REACT_APP_FSM_ORDER_ID`.

After user identity is available, provider selection is:
1. authenticated driver: configured driver snapshot provider, if factory returns one;
2. otherwise: configured single-order snapshot provider, if configured;
3. otherwise: legacy Redux snapshot provider.

The driver provider requires an API URL and a driver user ID. The ID comes from `REACT_APP_FSM_DRIVER_USER_ID` or the authenticated user ID. The order provider requires both API URL and `REACT_APP_FSM_ORDER_ID`.

The same `REACT_APP_FSM_API_URL` configures the driver Command transport. Thus the command transport can be active even when no driver snapshot provider can be created (e.g. missing driver ID and no authenticated driver at the point of construction). For authenticated drivers, the runtime ID normally supplies the missing value.

## 3. Driver lifecycle command route

The driver map UI calls `driverMapGateway` for:
- arrive;
- start;
- confirm boarding;
- finish;
- cancel/interruption;
- open card and request route areas.

For lifecycle actions, the gateway selects one of two paths:

**FSM path:** when `REACT_APP_FSM_API_URL` exists:
1. capture current completion baseline;
2. dispatch Interaction Action;
3. send `POST /api/commands/taxi/order/{orderId}`;
4. map UI action to server intent (cancel maps to `cancel_requested`; other lifecycle action strings pass through);
5. require accepted response with positive `instanceId`, status, intent and duplicate flag;
6. wait for terminal completion;
7. publish success only after `COMPLETED`.

**Legacy path:** when the command URL is absent:
- arrive: `setOrderState(Arrived)`, plus `arrivedVotingOrder` for voting;
- start: `setOrderState(Started)`;
- confirm boarding: `confirmVotingCode`, then `setOrderState(Started, code)`;
- finish: `setOrderState(Finished)`;
- cancel: `cancelDrive(orderId, reason)`.

Both paths publish the same public driver-map completion/failure event types. This is a meaningful compatibility boundary, but it is still a dual-transport deployment.

## 4. Command completion mode

`FsmCommandStatusTransport` is selected only when all are true:
- `REACT_APP_FSM_API_URL` is set;
- `REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`.

It polls `GET /api/commands/{instanceId}`, default 1000 ms (minimum 100 ms). If disabled, the gateway uses `SnapshotDriverCommandCompletionWaiter`, which waits for a qualifying driver snapshot change. Both modes have a 60-second default completion timeout.

This means the UI command can be accepted but not yet completed. The gateway deliberately does not emit the normal success event at acceptance time.

## 5. Findings

### PI-01 — Passenger mutations remain entirely on the legacy API

**Observed:** `LegacyPassengerGateway` registers an Interaction Contract handler, but its mutation switch calls legacy `backendGateway` methods:
- create/cancel order;
- select/release candidate;
- update waiting time;
- update customer price;
- complete ride.

There is no passenger Command transport in this source path. PI currently standardizes the UI/application boundary, not the passenger backend command protocol.

**Priority:** high for claims of full FSM migration; not necessarily a pilot blocker if legacy passenger API is the approved backend contract.

**Action:** explicitly classify Passenger as a legacy-backed PI adapter until Passenger Command API and aggregate passenger snapshot are implemented and deployed.

### PI-02 — Single-order provider can become the global non-driver provider

**Observed:** `App.tsx` selects `serverOrderSnapshotProvider` for every non-driver user whenever it was created. That provider is configured with one static `REACT_APP_FSM_ORDER_ID` and returns one order snapshot, not an aggregate passenger snapshot.

**Risk:** if `REACT_APP_FSM_ORDER_ID` is present in a general passenger deployment, all non-driver sessions may be attached to that fixed order snapshot rather than their own active-order collection. It appears suitable as a single-order integration/test mode, not as the default passenger provider.

**Priority:** high configuration risk.

**Action:** scope this provider to an explicit single-order/test route or feature flag; for normal passengers use the passenger aggregate provider or legacy Redux provider. Verify the actual production environment values before classifying as a deployed defect.

### PI-03 — Passenger UI treats an empty availableActions list as “no action contract”

In `PassengerSurface.resolve`, action-based hiding is applied only when `availableActions.length > 0`. If the snapshot has no actions, it falls back to state-derived legacy visibility. This is intentional compatibility behavior but means an empty action list does not mean “no commands allowed.”

**Priority:** medium; contract ambiguity/security boundary.

**Action:** distinguish “actions not supplied” from “explicitly supplied empty actions” (e.g. capability flag or nullable list). Regardless, backend must authorize every mutation; UI visibility is not authorization.

### PI-04 — Driver Command API and completion transport can be configured independently

The command transport activates from `REACT_APP_FSM_API_URL` alone. Command Status polling additionally requires `REACT_APP_FSM_COMMAND_STATUS_ENABLED=true`; otherwise completion is inferred from snapshots. Driver snapshot provider creation also needs a driver ID.

**Risk:** a partially configured deployment can send commands to FSM but wait for completion using a different/legacy snapshot source. A successful command might then time out if the legacy projection is not updated by that FSM command.

**Priority:** high deployment/configuration risk.

**Action:** introduce a single validated FSM deployment profile that checks command URL, driver snapshot identity/provider and selected completion mode together. At startup, log the resolved transport/provider names (without secrets) and fail closed or show a visible degraded state for incompatible combinations.

### PI-05 — Legacy adapter is a compatibility bridge, not a single backend gateway

`LegacyBackendGateway` wraps and observes many old API calls, but the repository still has direct API use outside it:
- Redux/Saga order mutations such as cancellation and collection polling;
- legacy passenger adapter delegates to backend gateway;
- other state modules and components retain legacy API/Redux responsibilities.

The adapter does not centralize all API access. The migration docs' statement that one particular UI bypass was the only remaining direct call is not a complete statement about the whole application; it referred to a narrower migrated UI scope.

**Priority:** medium architectural/documentation risk.

**Action:** keep the API register as the source of truth and distinguish “direct UI bypass” from “legacy Redux/Saga transport path.”

### PI-06 — Driver acceptance/offer actions are not in the FSM lifecycle gateway

The lifecycle gateway covers arrive/start/boarding/finish/cancel. Driver acceptance/take, offer submission, voting participation and some candidate operations remain in legacy API/state flows. Repository migration inventory explicitly says there is no confirmed intent/completion contract for all these actions.

**Priority:** high for complete driver FSM coverage; expected gap if only trip lifecycle was migrated.

**Action:** produce a separate command inventory for take/offer/voting/candidate actions. Do not move them to FSM until server intents, authorization, idempotency, terminal states and retry behavior are agreed.

### PI-07 — Driver map can optimistically advance local state before backend completion

Map handlers call `rememberOptimisticState` before invoking arrive/start, and the shared transition helper catches errors, logs them and refreshes state. Finish similarly clears local optimistic/demo state before the gateway resolves, then refreshes and navigates in `finally`.

This is designed to keep the map responsive and recover from backend lag. However, the visual state can temporarily lead the server state, and failure feedback is not consistently surfaced to the driver (errors are logged).

**Priority:** medium/high UX and operational risk.

**Action:** make pending/failed state explicit in the primary action UI. On a definitive command failure, roll back optimistic state or show a persistent retry/error state. Distinguish timeout/status-lookup uncertainty from server-declared FAILED.

### PI-08 — Order snapshot factory is a fixed-order provider, not passenger session resolution

The order snapshot transport is correctly scoped to `/snapshot/taxi/order/{orderId}` and has Query/WS stale-response protection. But the factory's static environment order ID does not discover the logged-in passenger's active order or maintain multiple orders. It must not be treated as a passenger-wide snapshot implementation.

**Priority:** high if used as a general passenger provider; no defect if restricted to explicit test/integration usage.

## 6. Existing test evidence located (not executed)

- `DriverMapGateway.test.js`: legacy lifecycle path, normalized failures, voting boarding, cancellation; FSM command and command-status paths.
- `FsmTaxiCommandTransport.test.js`: command request/accepted response validation.
- `FsmCommandStatusTransport.test.js`: command status protocol and polling config.
- `FsmDriverSnapshotTransport.test.js`: Query/WS mapping, recovery polling, revision/stale response handling.
- `FsmOrderSnapshotTransport.test.js`: order snapshot Query/WS and stale-response behavior.
- `LegacyPassengerGateway.test.js`: passenger commands route through PI and delegate to legacy API.
- `LegacyReduxSnapshotProvider.test.js`: Redux snapshot bootstrap and publication.
- `PlatformInterfaceRuntime.test.js`: provider lifecycle, action dispatch, refresh and stale-load protection.

No tests were executed as part of this audit.

## 7. Documentation consistency

The migration documents describe the PI work as a staged migration and explicitly retain legacy fallback. Some statements are scope-specific (e.g. “only remaining direct UI backend call”) and should not be read as a repository-wide guarantee. The current `DriverTripCancelModal` calls `driverMapGateway.cancel`, not `API.cancelDrive` directly, so older migration notes that identify that modal as an outstanding bypass are stale relative to this `main` snapshot.

## 8. Pilot verification checklist

Before enabling FSM in a pilot environment:
1. Confirm the actual values/presence of `REACT_APP_FSM_API_URL`, `REACT_APP_FSM_DRIVER_USER_ID`, `REACT_APP_FSM_COMMAND_STATUS_ENABLED`, `REACT_APP_FSM_WS_URL`, and the recovery poll interval.
2. Confirm authenticated driver provider selection and that the returned `driverUserId` matches the logged-in user.
3. Confirm whether completion uses Command Status or snapshot inference; test COMPLETED, FAILED, timeout and status-lookup failure separately.
4. Confirm that passenger users do not receive the fixed single-order provider unintentionally.
5. Verify passenger mutations still target the approved legacy backend and that the backend authorizes every action.
6. Verify take/offer/voting/candidate actions independently; they are not covered by the driver lifecycle Command gateway.
7. Verify failure feedback and state rollback on the real driver map, including weak network and reconnect.
8. Verify server-side authorization; do not rely on UI `availableActions` to secure commands.

## 9. Next stage

Audit runtime configuration, build, feature flags and external integrations. Compare declared environment variables with actual build/deployment configuration, identify secrets exposed to browser bundles, and separate verified runtime integrations from optional/fallback code paths.
