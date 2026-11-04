# Stage 21 — Passenger recovery across reload, logout and account switch

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: bootstrap cleanup, auth restoration, Redux state lifetime, passenger draft persistence, logout/login transitions, order selection and modal state.
- Source-only review. No production/backend runtime behavior is claimed; no fresh tests were executed.

## 1. Executive summary

The app creates a fresh in-memory Redux store on page load; it does not use Redux persistence. Authentication is restored asynchronously from `localStorage` tokens by `initUserSaga`. The passenger page starts its active-order watcher on mount, while its selected order, submitted-order ID/draft, previous state snapshots and rating-deduplication map are React component state/refs.

The recovery model is therefore mixed:
- authentication token persists across reload;
- server user profile is fetched again;
- active orders are fetched from the API after the user becomes available;
- selected order and pending submission correlation are not persisted;
- selected parts of the order form are persisted in localStorage;
- many derived runtime caches are deliberately deleted at every app boot;
- logout clears order Redux state only after the remote logout call succeeds.

This creates three material concerns: retained passenger phone data across account changes, incomplete cleanup on logout failure, and loss of the selected/pending order UI context on reload even if the backend order remains active.

## 2. Bootstrap and authentication restoration

### 2.1 Startup cleanup

`src/index.tsx` imports `preBootstrap` before creating the React root. `preBootstrap.ts` calls `resetStaleAppCache()`.

At every boot, `appCache.ts` removes a fixed set of runtime and draft keys from localStorage, including:
- route and map caches;
- passenger choice/rejected-choice/ETA/waiting/search-restart hints;
- `state.clientOrder.from`, `to`, `comments`, `time`, `customerPrice`, `pickupPrice`.

It deliberately preserves auth/user keys and other fields, including `state.clientOrder.phone`, `state.clientOrder.carClass`, `state.clientOrder.seats` and `state.clientOrder.locationClass`. The cleanup of those runtime keys is not conditional on a new build; only the separate versioned emulator account/ID cleanup is conditional.

The app unregisters its service worker in `index.tsx`; this is consistent with the earlier build/integration audit and means this entry does not provide an offline Redux recovery layer.

### 2.2 User restoration

`App.tsx` calls `initUser()` from an effect but renders `AppRoutes` immediately. `initUserSaga` reads `state.user.tokens`, dispatches `SET_TOKENS`, calls `API.getAuthorizedUser`, applies the user's language and dispatches `SET_USER`.

If token fields are absent, the Saga applies the saved language if available and returns. If the authorized-user request returns no user or throws, it removes the stored token. The reducer does not have a dedicated “auth restoration complete” state; initial `user` is null.

**Finding AUTH-21-01 — Medium: routes mount before auth restoration completes.**

The passenger route and its effects can mount while `user` is still null. The active-order watcher waits for a Redux action if no user is present, then the watcher lifecycle may continue after an action. This is not proof of an unauthorized order response, but it means the UI has no explicit auth-hydration gate at the route boundary. Verify first-poll ordering on reload and avoid rendering account-scoped data until the authenticated user identity is resolved.

## 3. Passenger draft persistence and cross-account data

### 3.1 Persisted values

`clientOrder/reducer.ts` initializes `from`, `to`, `time` and `phone` from localStorage. `clientOrder/sagas.ts` persists:
- pickup/dropoff points;
- car class, seats and location class;
- comments;
- time;
- valid phone number.

The selector for phone uses the current user's phone only when the saved form phone is invalid and `phoneEdited` is false. A valid persisted phone is therefore preferred over the newly authenticated user's phone.

Startup cleanup removes several persisted fields, but does not remove `state.clientOrder.phone`, car class, seats or location class. Logout does not invoke the client-order reset action.

### 3.2 Reset behavior

The client-order `RESET` reducer resets car class, seats, destination, destination polygons, comments, time, location-class selection mode and price fields. It does not reset:
- pickup point (`from`);
- phone or `phoneEdited`;
- location class itself;
- selected order ID;
- pickup polygons/loading state.

The corresponding `resetSaga` removes persisted car class, seats, destination, comments, time and prices. It does not remove persisted pickup point or phone. The boot cleanup separately removes pickup point, but still preserves phone.

**Finding PASS-21-01 — High: passenger phone can cross account boundaries on a shared browser.**

A valid phone saved by one passenger is loaded into the next Redux instance and can take precedence over the newly authenticated user's profile phone. Logout does not clear it, and startup cleanup preserves it. On a shared device this can prefill a new passenger's order with another account's contact number. Clear or scope contact data by authenticated user ID, and define whether the phone is a user profile attribute or a per-order override.

**Finding PASS-21-02 — Medium: passenger form reset is partial and inconsistent with startup cleanup.**

The explicit form reset and boot cleanup remove different key sets. The reset leaves pickup point, phone, location class and selectedOrder in memory; boot cleanup removes pickup point but preserves phone and some selection settings. Define one documented reset policy for “new order”, “logout” and “new app boot” rather than treating these as equivalent operations.

## 4. Logout and account-switch lifecycle

### 4.1 Logout ordering

`logoutSaga`:
1. dispatches `LOGOUT_START` (the user reducer immediately clears in-memory user and tokens);
2. removes `state.user.user` and `state.user.tokens` from localStorage;
3. calls `API.logout`;
4. only after success dispatches `LOGOUT_SUCCESS` and `clearOrders()`;
5. on API failure dispatches `LOGOUT_FAIL` and does not clear orders.

`clearOrders()` clears active/ready/history ID lists and nulls the normalized order records. It does not clear `clientOrder` state or modal state.

### 4.2 Login ordering

`LOGIN_START` clears user and tokens in the user reducer. The login Saga stores new tokens, navigates according to role, and dispatches `LOGIN_SUCCESS`. It does not dispatch `clearOrders()`, reset client-order state or close all modals before switching the account.

Google login similarly stores tokens and dispatches success without clearing orders/client-order/modal state. The user reducer's login-success actions replace the user, not the rest of the root Redux tree.

**Finding AUTH-21-02 — High: order cleanup is conditional on remote logout success.**

If `API.logout` rejects, the browser has already removed local auth tokens and the Redux user has already been cleared, but order state is not cleared. A subsequent login in the same SPA can inherit the previous account's in-memory order collections until they are replaced by a successful list response. This is a cross-account isolation risk even if the backend correctly scopes its responses. Clear account-scoped state locally in a guaranteed cleanup path, independent of the remote logout result.

**Finding AUTH-21-03 — High: successful account switch does not explicitly clear account-scoped frontend state.**

Login and Google login do not clear orders, selected order, client-order draft or modals. The normal route/polling lifecycle may eventually reconcile some of this state, but there is no explicit atomic account-boundary reset keyed to the old and new `u_id`. Add one account-switch reset before exposing the new user's passenger/driver surface.

**Finding AUTH-21-04 — Medium: logout does not reset passenger draft or modal state.**

Even when remote logout succeeds and `clearOrders()` runs, the client-order slice and modal slice remain in memory. The route may unmount, but those Redux values survive until a later action or full page reload. This includes selectedOrder ID, contact data and open modal payloads. Clear these explicitly at logout/account switch.

## 5. Active order, selected order and pending submission recovery

### 5.1 Active order recovery

The Redux orders store is in-memory only. On passenger mount, `useEffect(watchActiveOrders, [])` starts the active-order watcher. The watcher waits for an authenticated user, then requests active orders; the active-order Saga polls the backend and replaces the active ID list with the returned data.

The backend is therefore the source of truth for active-order recovery after reload. The browser does not persist a pending order ID or full active-order snapshot for the passenger page.

### 5.2 Selected order and pending creation

Passenger page state includes:
- `submittedOrderId`;
- `submittedOrderDraft`;
- `isCreatingAnotherOrder`;
- `cancelRequestedOrderId`;
- previous active-order and driver-state refs;
- `finishedRatingShownRef`.

These are React state/refs, not persisted storage. The Redux `clientOrder.selectedOrder` is also in-memory only and is not restored by the client-order reducer's localStorage initializer.

If the page reloads after the create request succeeds but before the active-order polling response has been correlated with `submittedOrderId`, the local pending ID/draft is lost. After reload, the active order can still be returned by the backend, but the “created by this submission” handoff and locked-draft presentation are not reconstructed from a durable client-side correlation record.

If the order is already in active orders, the passenger page can display the order in its active collection; however, the prior selected order is not automatically restored because its selected ID is not persisted.

**Finding PASS-21-03 — Medium: active order can recover without restoring passenger selection.**

Reload reconstructs the active list from backend but not the previously selected order ID or expanded panel state. A passenger may return to the order screen and see the generic form/map rather than the in-progress order context. If seamless continuation is required, restore selection only after validating that the stored order ID belongs to the authenticated user and is present in the fresh active-order response.

**Finding PASS-21-04 — Medium: pending create correlation is lost on reload.**

The submitted order ID and draft are component-local. A reload between successful create response and list reconciliation loses this correlation. The order may later appear in active orders, but the explicit “submission pending → visible order” transition and locked draft are not recoverable. Add a short-lived, user-scoped pending-order record or make the server response/list contract sufficient to recover the current order deterministically.

## 6. Rating and modal recovery interaction

The finish/rating detector uses `finishedRatingShownRef`, a component-local map keyed by order ID. It prevents duplicate automatic opening only for the current Passenger component lifetime. It is reset on reload/remount. Stage 20 already established that RatingModal closes before the API response and does not persist a successful-submission marker or read back an existing rating.

The modals reducer is also in-memory only. `clearOrders()` does not close modals; logout does not call `closeAllModals()`. A full reload resets modal state, but an in-SPA logout/account switch can retain modal state unless another path closes it.

**Finding PASS-21-05 — Medium: rating deduplication is session-local and not tied to server rating state.**

After reload, a still-active Finished order may trigger the rating prompt again because the local ref has reset. The client has no authoritative rating readback/submission state to suppress a duplicate prompt safely. Resolve with a backend rating state/readback or idempotent SetRate contract, not only a persistent browser flag.

**Finding PASS-21-06 — Medium: modal state is not part of logout cleanup.**

The modal reducer is separate from orders and user reducers. Neither `clearOrders()` nor the logout Saga closes all modals. A same-SPA account switch can preserve modal flags/payloads from the prior account. Reset modal state at the account boundary.

## 7. Test coverage and evidence boundaries

The E2E inventory includes a passenger SOS scenario that reloads after cancellation and verifies the canceled order does not return. This demonstrates one completed-order cancellation recovery path against the live backend; it does not cover account switching, logout failure, persisted passenger phone, selected-order restoration, pending create correlation or rating prompt deduplication.

The reviewed E2E inventory does not identify dedicated scenarios for:
- reload while a Standard/Voting/Offer order is still active;
- reload between create response and active-list reconciliation;
- reload while a passenger order is selected/expanded;
- logout with API success and with API failure;
- logging in as a different passenger in the same browser context;
- verifying that the new account's phone is not prefilled with the previous account's phone;
- clearing modal state and selectedOrder at logout/account switch;
- rating prompt after reload and rating readback/idempotency.

No fresh Jest/TypeScript/Playwright run was performed in this stage. Historical test results in prior audit stages are not a substitute for these scenarios.

## 8. Recommended implementation order

1. Make logout cleanup unconditional locally: clear orders, client-order slice and modals in a finally-style path even if the remote logout endpoint fails.
2. Add an explicit account-boundary reset before LOGIN_SUCCESS/GOOGLE_LOGIN_SUCCESS exposes a different user; scope cleanup to the previous authenticated identity.
3. Scope persisted passenger phone and any account-derived draft data to user ID, or clear them on logout. Do not let one passenger's phone become another passenger's default.
4. Define and implement separate reset contracts for new order, logout/account switch and app boot.
5. Decide whether selected active order should be restored after reload. If yes, persist only its ID with user scope and validate against fresh backend active orders before selection.
6. Recover a pending create response/list handoff with a user-scoped short-lived pending ID, or redesign the flow so a successful create response is sufficient to restore it.
7. Replace the rating component's in-memory deduplication with backend-authoritative rating status/readback and idempotent submission.
8. Add E2E cases for reload-active, reload-pending-create, logout failure, account switch/contact isolation, modal cleanup and rating reload behavior.

## 9. Files reviewed

- `taxi/src/preBootstrap.ts`
- `taxi/src/appCache.ts`
- `taxi/src/index.tsx`
- `taxi/src/App.tsx`
- `taxi/src/state/index.ts`
- `taxi/src/state/rootReducer.ts`
- `taxi/src/state/user/reducer.ts`
- `taxi/src/state/user/sagas.ts`
- `taxi/src/state/clientOrder/reducer.ts`
- `taxi/src/state/clientOrder/sagas.ts`
- `taxi/src/state/clientOrder/actionCreators.ts`
- `taxi/src/state/modals/reducer.ts`
- `taxi/src/pages/Passenger/index.tsx`
- `taxi/src/state/orders/sagas.ts`
- `taxi/e2e/passenger-sos.spec.ts`
- `taxi/e2e/README.md`

No application source files were modified. No PR was created.
