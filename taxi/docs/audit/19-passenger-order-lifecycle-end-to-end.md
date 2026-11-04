# Stage 19 — Passenger order lifecycle end-to-end

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: passenger order creation, insertion into active-order state, selection/detail resolution, lifecycle state observation, completion/rating transition, disappearance from active list, and reload/recovery boundaries.
- This is a source audit. No new runtime or live-backend test was executed in this stage.

## 1. Executive summary

The passenger order lifecycle is split across four cooperating mechanisms:

1. The form submits through the Redux thunk `ordersActionCreators.create` to `API.postDrive`.
2. Successful creation dispatches `CREATE_SUCCESS`, which triggers a fresh active-order request. The returned `b_id` is also kept in transient React state as `submittedOrderId`.
3. The passenger page promotes the submitted order to the selected order only after that ID appears in `activeOrders`. The selected order itself is resolved from the active-order collection, not from a separately fetched detail object.
4. Completion/rating is detected from driver state transitions in the active list, or by a one-order fetch when an order disappears before the passenger page observed `Finished`.

The design has sensible independent readback and recovery paths, but it has lifecycle gaps:
- creation acknowledgement and visibility in the active list are separate events; there is no explicit timeout/error state for a successfully created order that never appears in the list;
- voting creation performs a follow-up `SetConfirmState` request whose failure is logged and swallowed, while active-list filtering requires `b_confirm_state`;
- passenger selection depends on the active collection and a Redux selected ID, so temporary list absence clears the selection;
- rating deduplication is held only in component memory and is not a durable per-order completion marker;
- the app's local choice/ETA/rejected-driver hints can influence presentation but are not backend assignment state (stages 17–18).

## 2. Creation: form → Gateway → API → Redux

### 2.1 Form submission

`taxi/src/pages/Passenger/VotingForm.tsx` constructs the request payload from the form and submission-time Redux reader. It sends:
- pickup/destination and coordinates;
- passenger/contact and order configuration;
- passenger count, car class, payment method, location class;
- waiting time and optional customer price;
- mode-specific fields for Voting and Offer.

The submit handler sets `submitting=true`, awaits `createOrder(payload)`, stores the mode for the returned `b_id` using `setStoredChoiceOrderMode`, resets the client-order form for Standard orders, then calls the page's `onSubmit(data, draft)`. Errors are surfaced through the form's submit error and console; the submitting flag is reset after the try/catch.

### 2.2 Redux thunk and API

`taxi/src/platform/adapters/LegacyPassengerChannelStoreAdapter.ts` binds the form's `createOrder` prop to `ordersActionCreators.create`.

`taxi/src/state/orders/actionCreators.ts` implements:
- `API.postDrive(...params)`;
- on success, dispatch `CREATE_SUCCESS` with `record.b_id`;
- return the created record to the form.

`taxi/src/API/order.ts` `_postDrive`:
- applies cash as the default payment method;
- normalizes the request through `reverseConvertOrder`;
- POSTs to `/drive`;
- retries only recognized backend shape errors for `b_options` (normal → array-values → omit);
- rejects an HTTP-200 body with `status === 'error'`;
- converts returned `b_id` to string;
- for Voting, sends a second request to `/drive/get/{b_id}` with `action=SetConfirmState`.

Important distinction: failure of this second Voting confirmation request is caught and only logged. The create promise still resolves with the original order record. This means the UI can proceed as if creation succeeded even though the follow-up confirmation was not acknowledged.

### 2.3 Create event and active-list refresh

The orders Saga subscribes to `CREATE_SUCCESS` and runs `getActiveOrdersSaga` with latest semantics. Thus creation does not insert the returned full order object directly into the collection: it triggers a server list refresh.

The passenger page's `onSubmit` stores `submittedOrderId`, clears the Redux selected order, and closes the form panel. A subsequent effect searches `activeOrders` for that exact ID. Only when found does it:
- write `ORDER_CREATED` with UI state `OrderVisibleInActiveOrders`;
- clear the pending submitted ID/draft;
- call `setSelectedOrder(submittedOrder.b_id)`;
- close the expanded form panel.

This is a two-phase UI lifecycle: backend create acknowledgement first, active-list visibility second.

**Finding PASS-19-01 — Medium: submitted order can remain in a pending state if it never enters activeOrders.**

There is no visible timeout or explicit recovery/error branch around `submittedOrderId` waiting for list visibility. A failed/late list refresh, backend confirmation filtering, or inconsistent backend response can leave the client waiting without a clear actionable state. Add a bounded wait with a manual refresh/recovery path, while preserving the known-created `b_id`.

**Finding PASS-19-02 — High for Voting: follow-up confirmation failure is swallowed.**

The Voting `SetConfirmState` request is best-effort in `postDrive`; its failure does not reject creation. However, `getOrders(Active)` filters returned bookings to `b_confirm_state`. If the confirmation did not persist, the created order may not appear in the active list, while the form already considers submission successful. This is a direct candidate explanation for PASS-19-01 in Voting mode. The actual backend behavior on confirmation failure requires a controlled test.

## 3. Active list, selected order and detail ownership

### 3.1 Active-order read model

`API.getOrders(EOrderTypes.Active)` POSTs to `/drive?fields=00000000u1`, then:
- attaches the user record to each active booking;
- applies hidden-order and configured test-user filtering;
- converts backend records through `convertOrder`;
- filters out orders without `b_confirm_state`;
- sorts by `b_start_datetime`.

The active-order Saga validates response code `200`, applies duration updates and expiry handling, then dispatches `GET_ACTIVE_ORDERS_SUCCESS` with the returned collection. It emits diagnostic events comparing the payload with the selector result.

The passenger screen watches active orders on mount. The poll loop waits for the request success/failure before the next interval. The source contains no separate passenger-specific authoritative detail store for the selected order.

### 3.2 Selection is an ID over the active collection

`LegacyPassengerChannelStoreAdapter` maps:
- `activeOrders` from `ordersSelectors.activeOrders`;
- `selectedOrder` from `clientOrderSelectors.selectedOrder`;
- `setSelectedOrder` from the client-order Redux slice.

In `pages/Passenger/index.tsx`, selected order is resolved by finding `selectedOrderID` in `activeOrders`. If the ID is absent, the derived selected order becomes null.

When a submitted order appears, the page selects it automatically. The order click handler also selects an order by ID. If a selected order disappears from the active collection, an effect collapses the panel and clears the selected ID (unless the page is still waiting for the just-submitted order).

**Finding PASS-19-03 — Medium: selected-order detail is not resilient to transient active-list omission.**

The passenger screen derives the detail view solely from the active collection. A temporary omission during polling or filtering clears selection and collapses the panel; there is no passenger-side `getOrder` fallback in this selection resolver. The special one-order fetch described below is only for completion detection, not general detail recovery. Consider retaining the selected ID and fetching its detail before treating a transient omission as terminal.

### 3.3 Empty response behavior

When the active-order Saga receives an empty result, it explicitly dispatches `setSelectedOrder(null)` before storing the empty collection. This is broader than the passenger page's conditional cleanup and can clear selection on a successful empty response. Whether an empty active response is always authoritative for the passenger role depends on backend contract and should be verified.

## 4. Driver/order lifecycle as observed by passenger UI

The passenger screen observes both:
- order-level `b_state`;
- each driver's `c_state`.

It records flow events for order state changes, candidate additions/removals, driver state changes and trip milestones. The main UI's selected-driver resolver is mode-sensitive:
- a stored local confirmed choice can take precedence if the matching driver is not Canceled;
- for candidate/voting modes without a stored simple-order mode, an unselected `Performer` is deliberately not treated as the selected driver;
- otherwise it searches for Performer, Arrived, Started or Finished.

The MiniOrders resolver has its own selected-driver logic. Stage 18 documented that it also trusts a locally confirmed driver ID if that driver is not Canceled. PassengerLiveOrder has a third resolver with a stricter requirement for a locally confirmed choice (Performer or later). These are separate display resolvers and should not be mistaken for backend assignment authority.

### Lifecycle states

| Backend driver state | Passenger-side observation | Important qualification |
|---|---|---|
| Considering | candidate/response list for choice modes | Not proof that a driver has been assigned |
| Performer | driver moving to pickup / selected driver for simple order | In choice modes may still represent an offer, not passenger-confirmed selection |
| Arrived | passenger arrival notice; selected order is expanded if it is the current selection | Notice depends on observing a transition into Arrived while the order is in activeOrders |
| Started | trip-started event; transient message is cleared | Chat is closed by PassengerLiveOrder when the trip is started |
| Finished | review eligibility event and rating modal request | Detected in active list or through a one-order read after list disappearance |
| Canceled | driver stopped moving; other driver/order behavior depends on order state and remaining drivers | Driver cancellation is not the same as whole-order cancellation |

Order-level `b_state` changes are logged separately from driver `c_state`. Therefore the passenger UI lifecycle is not represented by a single status field. Tests and diagnostics should assert both when the backend contract requires it.

## 5. Finished, disappearance and rating

### 5.1 Finished while still in activeOrders

The passenger page keeps `previousDriverStates` in a React ref. When a driver's state changes to `Finished`, and the per-order `finishedRatingShownRef` has not been set, it:
- logs review eligibility and request events;
- marks that order ID in the in-memory ref;
- clears pickup price;
- exits "creating another order" mode;
- selects the finished order;
- clears the message modal;
- opens RatingModal for that order.

The guard is scoped to the mounted component instance and keyed by order ID.

### 5.2 Order disappears before Finished was observed

The page also compares the previous active-order list with the new one. For an order that disappeared, it looks for a non-Canceled driver. If that driver's last observed state was no later than Started, it calls `passengerGateway.getOrder(order.b_id)`. If the readback shows a non-Canceled driver at Finished, it logs completion/review events and opens the rating modal.

This is a useful recovery path for a race where the backend removes the order from the active list before the passenger polling loop observes the Finished state.

### 5.3 Gaps

**Finding PASS-19-04 — Medium: rating deduplication is memory-only.**

`finishedRatingShownRef` is not persisted and is reset when the Passenger page remounts. The active-list and removed-order paths share this ref within one mount, but there is no durable per-order "rating already submitted/shown" state. A reload while a finished order remains discoverable, or multiple entry points to the rating flow, can cause the prompt to reappear. The source audit does not establish that this currently duplicates a backend rating; it establishes that UI prompt idempotency is not durable.

**Finding PASS-19-05 — Medium: removed-order completion check is best-effort and errors are only logged.**

The `getOrder` fallback catches errors with `console.error` and does not expose a retry or user-visible state. If the active list has already removed the order and the detail read fails, the page can miss the automatic rating prompt for that transition. A bounded retry or a history/review recovery entry point is advisable.

**Finding PASS-19-06 — Medium: completion lifecycle tests need explicit order-level and driver-level assertions.**

The existing E2E suite has a real driver trip-finish scenario (TEST-E2E-010) for Started → Finished, and passenger-driver flow TEST-E2E-009 stops at Started. The source contains passenger-side rating detection paths, but the reviewed E2E inventory does not establish an integrated passenger observation of Finished, active-list removal, fallback `getOrder`, and rating-modal idempotency.

## 6. Cancellation and active-list removal

Whole-order cancellation is routed through the passenger cancel modal and the `ordersActionCreators.cancel` / `API.cancelDrive` path (Stage 16). The API sends `set_cancel_state` to `/drive/get/{id}`. After cancellation, the active list is expected to omit the order; the passenger page's selected-order cleanup then clears the selection if the ID is no longer present.

The driver's `c_state` may remain Performer or Started in backend readback after the order is canceled; prior E2E evidence records this behavior. Therefore:
- whole-order cancellation must be asserted with order-level `b_state` and active-list membership;
- driver-level state alone must not be used to decide whether the passenger order remains active.

Existing TEST-E2E-006/012 provide cancellation evidence for their documented paths. Do not generalize a test of API-fixture cancellation to every UI mode or every order state.

## 7. Reload and recovery boundaries

### State that survives via backend

On page reload, active orders are reconstructed from `API.getOrders(Active)`; the selected order ID and in-memory refs are not a server-side lifecycle record. The backend's returned `b_state`, `b_confirm_state`, driver records and order data are the authoritative reconstruction inputs.

### State that is transient or browser-local

- `submittedOrderId`, `submittedOrderDraft`, `previousDriverStates`, `previousFlowSnapshot`, `finishedRatingShownRef`, and other page refs/state are component memory.
- `selectedOrder` is a Redux client-order slice value; no server persistence is shown in the reviewed adapter.
- Confirmed choice, rejected candidate IDs, choice search restart and pickup ETA hints are localStorage-backed helper state reviewed in Stages 17–18. They can influence display, but do not constitute server-confirmed assignment.
- App startup cleanup removes selected passenger choice/rejected/ETA/waiting keys (Stage 18), so local hints are not a durable recovery mechanism across a fresh application boot.

**Finding PASS-19-07 — Medium: reload loses in-flight submission and UI transition context.**

A reload between successful `POST /drive` and active-list visibility discards `submittedOrderId`; the user may still find the order if it appears in the backend active list, but the app no longer has the pending ID needed to auto-select it. A reload also resets the in-memory rating deduplication and previous-state transition history. Define an explicit recovery policy for recently created/finished orders rather than relying only on component-local state.

## 8. Test coverage map

| Scenario | Test evidence in repository | What it establishes | Remaining gap |
|---|---|---|---|
| Standard/Voting/Offer form creation | TEST-E2E-008 `passenger-order-creation.spec.ts` | Real UI form submission and saved order for all three modes (as documented in E2E README) | Repeated confirmation failure, active-list omission and pending-state timeout |
| Standard form through driver assignment and Started | TEST-E2E-009 `passenger-driver-flow.spec.ts` | One same-`b_id` chain from passenger form through backend Performer, Arrived and Started, with independent backend readback | Passenger observation of Finished and rating; reload at intermediate points |
| Passenger full cancellation | TEST-E2E-006 `offer-passenger-cancel.spec.ts`; TEST-E2E-012 standard cancel before assignment | UI cancellation paths documented in E2E inventory | Cross-mode cancellation after Started and consistent selected-order cleanup |
| Driver trip finish | TEST-E2E-010 `trip-finish.spec.ts` | Driver UI transition Started → Finished with backend readback | Passenger rating trigger, removal race and modal idempotency |
| Driver interruption | TEST-E2E-011 `trip-interruption.spec.ts` | Driver UI transition Started → Canceled with backend readback | Passenger-side response and active-list reconciliation |
| Passenger candidate choice/release | TEST-E2E-003/004 and Stage 16–18 review | Choice/offer happy paths and selected candidate state | Local fallback, reload, state mismatch and all release/retry branches |

Coverage statements above describe repository test design/documentation. They do not claim a fresh execution of all scenarios on this audit baseline.

## 9. Recommended priority

1. **P1 — Voting confirmation:** make `SetConfirmState` failure observable to the caller or provide an explicit retry/repair path; add a test proving that a created Voting order becomes visible in `getOrders(Active)`.
2. **P1 — Pending created order:** retain the created `b_id` and show a bounded pending/recovery state when it does not appear in activeOrders.
3. **P1 — Selected order readback:** before clearing a selected order on temporary active-list omission, fetch that order or distinguish terminal absence from a transient list response.
4. **P2 — Rating idempotency:** persist/derive per-order review state and test page remount/reload so a finished trip does not repeatedly prompt after rating has been completed.
5. **P2 — Completion fallback:** add retry/visible recovery when `getOrder` fails after an order disappears from activeOrders.
6. **P2 — Integrated passenger finish E2E:** one same-`b_id` scenario should verify Started → Finished, active-list removal, passenger rating prompt, and reload/dedup behavior.

## 10. Source files reviewed

- `taxi/src/pages/Passenger/VotingForm.tsx`
- `taxi/src/pages/Passenger/index.tsx`
- `taxi/src/components/PassengerLiveOrder/index.tsx`
- `taxi/src/components/MiniOrders/index.tsx`
- `taxi/src/platform/adapters/LegacyPassengerChannelStoreAdapter.ts`
- `taxi/src/state/orders/actionCreators.ts`
- `taxi/src/state/orders/sagas.ts`
- `taxi/src/API/order.ts`
- `taxi/e2e/README.md`

No application source files were modified. No PR was created.
