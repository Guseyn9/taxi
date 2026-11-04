# 06. Redux, Saga and state ownership

## 1. Evidence baseline

**Repository:** `Guseyn9/taxi`  
**Branch:** `main`  
**Commit:** `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`

Reviewed:
- `state/rootReducer.ts`, `state/rootSaga.ts`
- `state/orders/{constants,reducer,selectors,actionCreators,sagas}.ts`
- `state/clientOrder/{constants,reducer,selectors,actionCreators,sagas}.ts`
- `state/order/{reducer,selectors,sagas}.ts`
- `platform/adapters/LegacyReduxSnapshotProvider.ts`
- `platform/adapters/LegacyPassengerChannelStoreAdapter.ts`
- `platform/adapters/FsmDriverSnapshotTransport.ts`, `FsmOrderSnapshotTransport.ts`
- `App.tsx`

Source inspection only; no tests executed. Findings apply to the pinned `main` baseline, not yet confirmed against the pilot integration branch.

## 2. State ownership map

| Data / responsibility | Current owner | Update mechanism |
|---|---|---|
| Active, ready, history order collections | `state/orders` | Redux-Saga polling via `API.getOrders` |
| Per-order full/partial records | `state/orders.orders[b_id]` | list payloads, detail polling, mutation lifecycle |
| Order detail screen state | `state/order` | separate Saga calling `API.getOrder` |
| Passenger draft order | `state/clientOrder` | reducer + point/configuration sagas |
| Passenger draft persistence | browser localStorage | `clientOrder/sagas.ts` |
| Platform passenger/driver snapshots | Platform Interface | FSM Query/WS transport or legacy Redux provider |
| Driver lifecycle commands | `DriverMapGateway` | FSM Command API when configured; legacy gateway fallback otherwise |

Root Redux combines 11 state modules. Root Saga starts geolocation, clientOrder, user, cars, orders, order details, order, config and areas. Modal state and order-control mode are reducers without dedicated root sagas.

## 3. Order list polling and normalized store

### 3.1 Polling model

The orders saga polls:
- active orders: 5 seconds (driver and client constants currently both 5 seconds);
- ready orders: 3 seconds;
- history: 10 seconds;
- an individually watched order: 5 seconds.

On Android Chrome, the polling interval is multiplied by 1.75. Each watcher waits for the matching SUCCESS or FAIL action before scheduling its next delay. Ready-order polling explicitly emits FAIL on the missing-car path so its watcher is not stranded.

The ready-orders polling test exercises the actual watcher/saga interaction and verifies that failure paths continue polling. The existence of that test is not evidence it was executed in this audit.

### 3.2 Store representation

The orders reducer keeps:
- `activeOrders`, `readyOrders`, `historyOrders`: lists of IDs;
- `orders[id].partial`: order data from collection responses;
- `orders[id].value`: individually fetched, fuller order data;
- `listeners`: active collection/detail subscriptions;
- `mutations`: in-flight mutation count;
- `stale`: mutation completed; detail refresh is required.

Selectors prefer `value ?? partial`. Per-order action controls use `orderMutates`, which is true while a mutation is active or a refresh is marked stale.

## 4. Findings

### STATE-01 — Full detail value can mask newer collection data

**Observed source behavior:**
1. `GET_ORDER_SUCCESS` writes the individually fetched order into `orders[id].value`.
2. A later active/ready/history list response updates `orders[id].partial`.
3. During collection merge, the reducer updates the old record's `partial` and listener count, but does not invalidate or merge the old `value`.
4. Selectors return `value ?? partial`, so the old detail value continues to win over the newer list payload.

The individual order watcher normally refreshes a watched order, which can hide this issue during the detail screen. However, a record may remain retained by collection listeners after a detail watcher is removed. In that interval, a later collection poll can carry newer state while selectors continue to expose the older full value.

**Priority:** medium/high; depends on subscription overlap and payload freshness.

**Required verification:** add a reducer/selector test:
- start with a collection listener and partial order;
- dispatch `GET_ORDER_SUCCESS` with a full value;
- dispatch a collection SUCCESS with changed `b_state` / `drivers`;
- assert what the selector returns and whether it reflects the newer server state.

**Possible remedies:** merge collection changes into the full value for shared fields, invalidate full value and schedule a detail refresh, or attach server revision/update time and choose the newer record. Do not blindly replace full detail with a partial list payload.

### STATE-02 — Separate detail store and collection store can diverge

The app has both `state/order.order` (for the detailed order route) and normalized `state/orders.orders[id]` (for cards, lists and snapshots). The detail Saga calls `API.getOrder` and writes its own reducer; collection polling writes a separate representation. The same order can therefore have two independently refreshed client-side copies.

**Priority:** medium architectural risk.

**Recommendation:** document the canonical source for each consumer and add tests proving that command completion triggers refresh/reconciliation of both copies where both are mounted. Consider migrating detail consumers to the normalized order selector.

### STATE-03 — Passenger form coordinates are persisted separately from the active request lifecycle

`clientOrder/reducer.ts` initializes `from`, `to`, `time` and `phone` from localStorage. The clientOrder Saga writes several other draft fields to localStorage and reloads them after config is ready. This intentionally preserves a draft across reloads, but it also means localStorage is a second state source with its own schema and lifecycle.

The `RESET` Saga removes selected keys (`carClass`, `seats`, `to`, `comments`, `time`, `customerPrice`, `pickupPrice`) but does not remove `from`, `phone` or `locationClass`. This may be intentional (remember pickup and phone), but the retention policy should be explicit and tested. Otherwise a “new order” reset can leave old destination/selection values or stale persisted defaults.

**Priority:** medium; policy-dependent.

**Recommendation:** specify the intended retained fields for reset, and add reload/reset tests for each field. Include config-version migration for persisted objects if their shape changes.

### STATE-04 — `setStatus` action creator dispatches RESET instead of SET_STATUS

In `clientOrder/actionCreators.ts`, `setStatus(payload)` returns `{ type: ActionTypes.RESET, payload }`, while `clientOrder/constants.ts` defines `SET_STATUS` and the reducer handles that action. A call to this creator would reset the draft instead of changing status. Repository search did not find a current call site, so this is a dormant API defect, not a confirmed active user-path failure.

**Priority:** low; correct before using this action creator.

### STATE-05 — Coordinate truthiness remains in point saga

The clientOrder Saga has a numeric `hasCoordinates` helper, but subsequent geocoding and polygon branches use truthiness checks such as `value.latitude && value.longitude`. A valid point on latitude or longitude zero is therefore treated as if it has no coordinates in those branches. This matches the form/geocoding issue already logged as FORM-01/FORM-05; it is confirmed in the state layer as well.

**Priority:** medium for locations on the equator or prime meridian; low for Morocco pilot geography, but should be corrected consistently.

## 5. Platform snapshot boundary

`App.tsx` selects a driver FSM snapshot provider for authenticated drivers when configured; otherwise it selects the configured order FSM provider, then falls back to `LegacyReduxSnapshotProvider`. The legacy provider subscribes to Redux and fingerprints selected order ID, active/ready/history collections, user and derived passenger UI state before publishing a new snapshot.

The driver snapshot transport uses Query + WebSocket with recovery polling (default 5 seconds). It tracks query sequence, realtime epoch, server revision and update time to reject stale responses. This is a transport design, not proof that the target server is configured or that the deployed endpoint returns the expected contract.

### STATE-06 — Legacy passenger snapshot resolves selected order only from active orders

The legacy provider resolves `selectedOrder` by searching `activeOrders` for `selectedOrderId`. If a selected ID remains while the order is temporarily absent from the active list (polling race, transition to completed, backend filtering), the snapshot's selected order becomes null even though the ID remains selected. This may be intentional for the passenger state machine, but the resulting transition and available actions need explicit acceptance tests.

**Priority:** medium; verify behavior at driver assignment, trip completion and cancellation boundaries.

## 6. Test evidence located

- `state/orders/__tests__/readyOrdersPolling.test.js` — actual Saga polling loop and failure recovery.
- `platform/adapters/__tests__/LegacyReduxSnapshotProvider.test.js` — snapshot bootstrap, changed-state publication and no-op fingerprint.
- `platform/adapters/__tests__/FsmDriverSnapshotTransport.test.js` — Query/WS mapping, recovery polling and stale snapshot rejection.

No tests were executed in this audit. Search did not identify a direct test for the full/partial record precedence case or the `setStatus` action creator.

## 7. Priorities

| ID | Priority | Action |
|---|---|---|
| STATE-01 | Medium/high | Test and resolve stale full-value precedence |
| STATE-02 | Medium | Define canonical order copy and cross-store reconciliation |
| STATE-03 | Medium | Define/reset/persist draft field policy |
| STATE-04 | Low | Fix dormant `setStatus` creator |
| STATE-05 | Medium | Replace coordinate truthiness with numeric validity checks |
| STATE-06 | Acceptance verification | Test selected-order disappearance at lifecycle boundaries |

## 8. Next step

Continue with Platform Interface/FSM and legacy adapters:
1. establish exact provider selection and feature-flag conditions;
2. trace each driver/passenger command from UI to FSM or legacy backend;
3. identify direct API bypasses and mixed command paths;
4. verify snapshot projection completeness and action authorization;
5. separate code-level capability from deployment/configuration evidence.
