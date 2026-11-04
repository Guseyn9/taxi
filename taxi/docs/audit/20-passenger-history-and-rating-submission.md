# Stage 20 — Passenger order history and rating submission lifecycle

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: archive/history API and Redux plumbing, passenger access to completed orders, rating payload, modal close behavior, response/error handling, and test evidence.
- Source-only review; no live backend call or fresh test execution in this stage.

## 1. Executive summary

The codebase has a history/archive data path:
- `API.getOrders(EOrderTypes.History)` maps to `POST /drive/archive`;
- the orders Saga fetches the history list;
- Redux stores history order IDs and normalized order records;
- a selector exposes `historyOrders`.

However, the inspected UI consumer is the Driver page and Driver Orders screen. The passenger page adapter exposes active orders, selected order, and passenger actions, but does not expose `historyOrders` or `watchHistoryOrders`. No passenger history list or completed-order reopening path was found in the reviewed passenger UI.

Rating submission is similarly narrow:
- RatingModal captures stars, tips, and comment;
- it sends only stars through `backendGateway.setOrderRating(orderId, stars)`;
- API sends `action=SetRate` and `value`;
- the modal closes immediately, without awaiting the request;
- errors are logged/flow-recorded after the modal is already closed;
- no durable client-side submitted state or retry flow is visible in this component.

## 2. History/archive transport

### 2.1 API mapping

In `taxi/src/API/order.ts`, `getOrders` maps:
- Active → `/drive?fields=00000000u1`;
- Ready → `/drive/now`;
- History → `/drive/archive`.

The common response path applies the local hidden-order filter, test-user filter, `convertOrder`, `b_confirm_state` filtering and sorting. The same conversion/filter chain is used for History; there is no distinct passenger-history contract in this wrapper.

### 2.2 Redux and Saga

The orders state has a separate `historyOrders` ID list. `watchHistoryOrders` dispatches the history watcher; `watchHistoryOrdersSaga` performs an initial request and repeats after the configured history polling interval. `getHistoryOrdersSaga` calls `API.getOrders(EOrderTypes.History)`, maps completed-order duration, and dispatches `GET_HISTORY_ORDERS_SUCCESS`.

The reducer stores the history ID list and the corresponding partial order records in the shared normalized order map. The history selector returns this list after the role/emulator filter.

### 2.3 UI consumer

The selected-main UI consumer found for this history flow is:
- `pages/Driver/index.tsx`, which maps history orders and starts/stops `watchHistoryOrders` for the Driver role;
- `pages/Driver/Orders.tsx`, which renders a collapsible “Orders history” section from `historyOrders`.

The passenger adapter `LegacyPassengerChannelStoreAdapter.ts` maps only passenger active orders and selected order; it does not map `historyOrders` or `watchHistoryOrders`. The passenger page's reviewed selected-order resolver searches only the active-order collection. No passenger archive/history component or history watcher call was found in the reviewed passenger route.

**Finding PASS-20-01 — Medium: passenger history is not connected to the archive data path.**

The backend/API and shared Redux layers provide an archive list, but the passenger UI does not expose it in the selected baseline. A completed passenger order that has left Active therefore has no in-app history path identified by this audit. If passenger re-opening/review is a product requirement, it needs an explicit passenger history surface and an order-detail fetch path; the driver history screen is not a substitute.

**Finding PASS-20-02 — Medium: archive filtering shares active-list assumptions.**

The API wrapper applies `b_confirm_state` filtering and local `hiddenOrders` filtering to History as well as Active. This may be correct for the backend's archive contract, but it has not been verified against passenger-owned historical orders, especially orders whose confirmation state differs by mode. Add backend readback tests for completed Standard, Voting and Offer orders before reusing this endpoint as the passenger archive source.

## 3. Rating submission contract

### 3.1 UI fields and payload

`taxi/src/components/modals/RatingModal.tsx` maintains three local values:
- `stars`;
- `tips`;
- `comment`.

The tips and comment inputs are rendered and their values are included in local flow-event metadata as booleans (`hasTips`, `hasComment`). The actual call is:

`backendGateway.setOrderRating(_orderID, stars)`

No tips or comment argument is passed.

### 3.2 API request

`taxi/src/API/order.ts` `_setOrderRating` adds:
- `action: EBookingActions.SetRate`;
- `value: number`;

and POSTs to `/drive/get/{id}`. The API wrapper returns `res.data` without explicitly rejecting a successful HTTP response whose body contains `status: 'error'`. Thus a backend business error encoded in an HTTP-200 response may be treated as a resolved Promise by this method. Whether the server uses this response shape for SetRate requires a controlled contract test.

**Finding PASS-20-03 — Medium: rating form collects fields that are not submitted.**

Tips and comment are visible and editable but do not reach the rating API. The UI currently implies a richer review than the backend request carries. Either remove/disable these inputs until supported, or extend the backend/API contract and test the persisted fields.

**Finding PASS-20-04 — High: rating modal closes before submission result.**

The handler starts the asynchronous rating request and immediately closes the modal. There is no pending state, no duplicate-submit lock, and no visible success/failure result in the modal. A failed request leaves the user without an actionable retry path.

**Finding PASS-20-05 — Medium: HTTP-200 business error may be accepted as rating success.**

The API wrapper returns the response body directly and does not apply the `status === 'error'` rejection check used by some neighboring mutation methods. The RatingModal catch therefore may not run for a business error returned with HTTP 200. Verify the SetRate response contract and normalize it centrally.

## 4. Rating idempotency and repeat behavior

The RatingModal resets stars, tips and comment whenever it opens. No rating submission status is stored by order ID in this component. The page's `finishedRatingShownRef` (Stage 19) only prevents repeated automatic opening during one Passenger page mount; it does not prove that a rating was saved.

After a reload/remount, the finish detector can discover a Finished order again and open the rating modal again. Since the passenger history surface is not connected, the user also lacks a clear history entry from which to inspect or retry a failed rating.

No source-level mechanism was found that:
- fetches an existing rating for the order before showing the form;
- disables rating after a successful submission;
- records a durable local “submitted” state;
- retries a failed SetRate request;
- distinguishes “modal shown” from “rating persisted”.

**Finding PASS-20-06 — Medium: no durable rating-submission state or readback.**

The current UI cannot reliably distinguish a never-submitted rating, a successfully persisted rating, and a failed request after the modal closed. The backend's authoritative rating state/read endpoint must be identified before adding local persistence; local “submitted” flags alone could incorrectly hide a failed review.

## 5. Test coverage

The reviewed E2E inventory includes:
- TEST-E2E-010: driver UI Started → Finished;
- TEST-E2E-009: passenger form through driver Started;
- TEST-E2E-006/012: passenger cancellation paths.

No passenger E2E was identified for:
- opening a passenger history/archive screen;
- reopening a completed order from history;
- submitting a rating and independently reading it back from backend;
- rating business-error response handling;
- retrying after network failure;
- tips/comment persistence;
- duplicate rating submission or post-reload idempotency.

This is consistent with Stage 15's finding that Rating has no comparable E2E payload/error test. The present stage refines the exact API contract and confirms the missing history UI connection. Existing test inventory/documentation is not a fresh run on this audit baseline.

## 6. Recommended implementation order

1. Define whether passenger order history is required in the pilot. If yes, expose a passenger-specific history query and list; do not simply reuse the driver UI.
2. Verify `/drive/archive` ownership and response semantics for the passenger role and all three order modes.
3. Make SetRate response validation explicit: reject HTTP-200 business errors where present.
4. Keep RatingModal open while submitting; disable duplicate submission; show confirmed success or a retryable failure.
5. Decide whether tips/comment are supported. If not, remove misleading inputs; if yes, extend and verify the API contract.
6. Add an authoritative rating readback or backend idempotency contract so remount/reload cannot prompt or submit ambiguously.
7. Add E2E coverage for passenger history, rating success/readback, failure/retry and duplicate-submit behavior.

## 7. Files reviewed

- `taxi/src/API/order.ts`
- `taxi/src/state/orders/actionCreators.ts`
- `taxi/src/state/orders/sagas.ts`
- `taxi/src/state/orders/reducer.ts`
- `taxi/src/state/orders/selectors.ts`
- `taxi/src/pages/Driver/index.tsx`
- `taxi/src/pages/Driver/Orders.tsx`
- `taxi/src/pages/Passenger/index.tsx`
- `taxi/src/platform/adapters/LegacyPassengerChannelStoreAdapter.ts`
- `taxi/src/components/modals/RatingModal.tsx`
- `taxi/e2e/README.md`

No application source files were modified. No PR was created.
