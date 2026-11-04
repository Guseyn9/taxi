# Stage 22 — Driver recovery across reload, account switch and map remount

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: driver page lifecycle, active/ready/history watchers, normalized order cache, map state, GPS watch/send lifecycle, browser emulator persistence, account-scoped UI state.
- Static source review only. No production/backend runtime behavior is claimed. No fresh tests were executed.

## 1. Executive summary

The driver interface has two distinct recovery mechanisms:

1. Real driver state is expected to be reconstructed from authenticated user data, backend order lists and fresh geolocation. Redux order state is in-memory and is not restored from browser storage.
2. Driver map demo/emulator state has a module-level in-memory cache (`persistedDriverDemo`) that survives a map-tab unmount/remount within the same JavaScript page session. It does not survive a full page reload.

The app intentionally preserves browser emulator running flags across reloads, while startup cleanup removes emulator order IDs and emulator location snapshots. This can cause a restored “running” mode to start with its supporting local order/location data absent and force regeneration/reinitialization.

The driver page also has several local UI/ref caches keyed by order ID or current user. These are not durable across reloads. Some user-scoped caches are initialized once from the initial user and require careful review on in-SPA account changes.

The previous Stage 21 account-boundary finding applies equally to driver order collections: logout clears normalized orders only after successful remote logout; login does not explicitly clear them before a new user becomes visible.

## 2. Driver page and watcher lifecycle

### 2.1 Driver page effects

`pages/Driver/index.tsx` starts the driver's car fetch when `user.u_role === Driver`. It starts active, ready and history watchers only when:
- current user role is Driver; and
- `emulatorOrdersEnabled` is true.

The component initializes `emulatorOrdersEnabled` from browser-emulator state or external emulator enablement. A browser-emulator state event synchronizes that flag, clears orders and closes all modals.

The ready-order watcher additionally starts geolocation watching at a 20-second interval and activates geolocation sending. Its cleanup deactivates sending and unregisters the watcher.

**Finding DRV-22-01 — High / requires product-contract confirmation: driver order watchers are gated by emulatorOrdersEnabled.**

The ordinary driver page's active/ready/history watcher effects return early when `emulatorOrdersEnabled` is false. This is a significant control-flow condition. The application may supply the actual driver's list through another platform/provider path, but the reviewed page effects alone do not establish that the legacy Redux polling is active for a normal driver. Confirm the intended production source of driver orders for both emulator-on and emulator-off modes and test it on the selected deployment configuration. Do not interpret this source observation as proof that normal drivers receive no orders.

### 2.2 Redux orders

The normalized orders reducer initializes with:
- empty entity map;
- `activeOrders = null`;
- `readyOrders = null`;
- `historyOrders = null`.

List-success actions replace the corresponding ID list and merge partial order records. The `CLEAR` action nulls active/ready/history lists and clears cached full/partial order payloads while preserving listener/mutation record structure.

No localStorage hydration path for the normalized orders store was found in the reviewed reducer/action creator path. After a full reload, order lists must be fetched again from the configured data provider.

**Finding DRV-22-02 — Medium: driver order cache is intentionally volatile, but the UI has no explicit “recovery in progress” contract in the reviewed order store.**

The lists begin as null and are later populated by provider responses. Driver surfaces should distinguish “not loaded yet” from “loaded and empty”, particularly during token restoration or slow network startup. Confirm this distinction across the platform adapter and page rendering.

## 3. Map state and route recovery

### 3.1 Module-level state

`Driver/Map.tsx` defines `persistedDriverDemo` at module scope. It stores:
- optimistic per-order driver state overrides;
- last marker position, associated with order IDs;
- along-the-way order IDs and last order snapshots;
- declined, taking and boarded along-the-way IDs.

The comments explicitly state this cache is intended to survive unmount/remount when the driver switches map tabs. It is initialized to null values in module scope. It is not browser storage and does not survive a full reload, browser process restart or new tab.

On remount, map component state is initialized from this module cache. Optimistic state is dropped when the backend state catches up or the corresponding order disappears. Finishing an order removes that order's optimistic marker and clears route/along-the-way state when no trip plan continues.

**Finding DRV-22-03 — Medium: map continuity cache does not survive full reload.**

A driver who reloads during an active trip loses the in-memory marker position, optimistic state and along-the-way context. The map can reconstruct the backend order state and use fresh device GPS, but it cannot reconstruct the exact previous demo marker position or all transient multi-order plan decisions from this module cache. The comment's guarantee is limited to remounts within one page session, not reload recovery.

For real drivers, fresh GPS plus backend order state should be authoritative. For emulator/demo workflows, either persist a versioned, user-scoped snapshot or explicitly restart the simulated route from a documented safe point after reload. Never use a stale browser snapshot as authority for a real trip.

### 3.2 Route progress and trip actions

The map publishes its resolved position and trip target through driver map adapter events. On unmount it clears the published trip phase/target. The route model is created in the map lifecycle and rebuilt from the current trip plan. Source comments state that a rebuilt route begins at the last known marker coordinate and intentionally does not restore distance travelled on the old route geometry.

This is a deliberate geometry-safety strategy, not full route-progress persistence. It avoids replaying distance against a different route shape, but it also means a remount/rebuild is not a byte-for-byte continuation of the previous route model.

**Finding DRV-22-04 — Low/Medium: route reconstruction preserves a position snapshot, not route-model progress.**

The behavior is acceptable if the map marker position is the required continuity contract. Document that route geometry/progress is recomputed and test that it never changes backend order state or repeats lifecycle actions.

## 4. GPS and location sending

`orders/actionCreators.ts` starts a geolocation watcher when the ready-order watcher is mounted:
- watch interval: 20 seconds;
- activates location sending;
- cleanup deactivates sending and removes the watch.

The geolocation Saga maintains listener counts and the shortest requested polling interval. When sending is activated, it obtains a fresh GPS position, sends it to the location API and repeats every 20 seconds. A failed send is logged and the previous successful position remains the last-sent reference.

The Redux geolocation state is not persisted by the reviewed path. A reload therefore requires a new browser geolocation acquisition; the last Redux position is not restored from a durable store.

Startup cleanup removes `gruzvill_last_browser_geolocation` from localStorage and sessionStorage. The driver map requests browser geolocation on its own lifecycle and handles location-found events; this is separate from the ready-order watch/send Saga.

**Finding DRV-22-05 — Medium: GPS recovery is asynchronous and has no durable last-known driver position in this path.**

Immediately after reload, the driver map can temporarily have no current position until browser geolocation resolves. The ready-order sending Saga also needs a valid Redux geolocation before it can send. Ensure map action gates remain disabled until the correct fresh position is known; do not infer arrival from an absent or stale coordinate.

**Finding DRV-22-06 — Medium: location acquisition and location publication have separate lifecycles.**

The map's browser geolocation and the Redux watch/send path are separate mechanisms. A working map marker does not by itself prove that backend location updates are being sent, and a successful location send does not prove the map has rendered the same position. Add a test that observes both the marker source and the actual location API payload for an authenticated real driver.

## 5. Browser emulator recovery

### 5.1 Startup cleanup behavior

`appCache.ts` explicitly preserves emulator running state so that the emulator panel can restore after a reload while authentication remains active. However, the same startup cleanup removes:
- browser emulator driver/client order IDs;
- browser emulator driver locations;
- client order owner map;
- cached map state and several route/order keys.

The driver page initializes `emulatorOrdersEnabled` by reading browser emulator state and external emulator configuration. The emulator mode event causes the driver page to clear order lists and close modals.

**Finding DRV-22-07 — High for emulator workflows: running state survives while dependent emulator snapshots are removed.**

The code intentionally preserves running flags but removes order IDs and location snapshots on every app boot. The emulator is expected to reinitialize/regenerate fresh orders, as the source comments describe. Verify that all emulator modes reliably rebuild their state after reload, including denied geolocation, failed login, API outage and partial initialization. A “running” flag alone must not be treated as proof that the emulator has a healthy active session.

### 5.2 Offer and voting state

Driver offer/client-response simulation data is stored in localStorage under `driverOfferClientResponseSimulation`, keyed by user ID and order ID. This storage is not included in the exact startup-removal list shown in `appCache.ts`. Other offer/voting state keys are removed on boot (for example `driverOffers`, `driverVotingParticipations`, `driverVotingArrived`, `driverStartedVotingOrderIds`).

This creates a mixed persistence policy: some simulated response state survives reload, while other driver choice/participation state is deliberately discarded. The storage helper keys response records by user ID, which reduces accidental collision between users, but old records may remain until their own cleanup/expiry path removes them.

**Finding DRV-22-08 — Medium: emulator offer/voting persistence is inconsistent across related keys.**

Document which state is authoritative, which is simulation-only and which is expected to be regenerated after reload. Add expiry and user-scoped cleanup for retained simulation records. Do not let stale simulation outcomes influence a real driver order.

## 6. Account switching and local UI state

### 6.1 Logout and login

The user Saga clears in-memory user/tokens and removes their localStorage values at `LOGOUT_START`, but dispatches `clearOrders()` only after `API.logout` succeeds. If the remote call fails, it dispatches `LOGOUT_FAIL` without clearing orders.

Login and Google login replace the user but do not explicitly clear normalized order collections before success. Driver page effects and selectors may then reconcile state, but no atomic account-scoped reset is performed in the auth Saga.

This is the same root cause identified in Stage 21:
- logout failure can leave the previous account's order cache in Redux;
- login as another account can expose a new user while old account order lists remain until refreshed or cleared;
- modal and other slices are not reset by `clearOrders()`.

**Finding DRV-22-09 — High: driver order state is not cleared unconditionally at the authentication boundary.**

This is a cross-account isolation risk in the client store. The recommended correction is a single account-boundary reset that clears order collections, details, selected order, modal payloads, driver-local caches and account-scoped emulator state independently of remote logout success.

### 6.2 Driver order-list local state

`pages/Driver/Orders.tsx` keeps selected card ID, visible section toggles, status filter and hidden-order IDs in component state. Hidden-order IDs are initialized from `getHiddenOrderIds(user?.u_id)`; the component also responds to a custom event and browser storage events.

The selected order card ID and section/status UI choices are not persisted by this component. If the page remounts, the selected card and local view settings reset to defaults. The hidden-order helper is user-keyed, but the initial state is only computed at component initialization; verify that same-component user changes refresh the value through its user-change effect.

**Finding DRV-22-10 — Low/Medium: driver list selection and filters are volatile across remount/reload.**

This is primarily a continuity issue, not a backend trip-state issue. Decide which view preferences should survive reload and which should reset. If the authenticated user changes without unmounting the component, explicitly refresh user-keyed hidden-order state.

### 6.3 Driver notifications and ratings

Driver page notification and finished-rating deduplication use component refs keyed by order ID. They are in-memory only and reset on page remount/reload. Therefore, if a finished/canceled order is reintroduced by the backend or provider after reload, a notification/rating prompt may be eligible to appear again. Backend rating state/readback is needed to avoid duplicate rating workflows; client refs alone cannot guarantee durable deduplication.

**Finding DRV-22-11 — Medium: driver notification/rating dedupe is not durable.**

The UI should consult backend-authoritative state or use idempotent commands before presenting/repeating a rating workflow. Do not rely on a React ref to enforce cross-reload exactly-once behavior.

## 7. Test coverage and evidence boundaries

The reviewed E2E inventory documents passenger reload after SOS cancellation. It does not identify dedicated driver scenarios for:
- reload while a driver has an active Assigned/Arrived/Started trip;
- reload while a multi-order/along-the-way plan is active;
- reload during a pending lifecycle mutation;
- map tab unmount/remount preserving marker position and optimistic state;
- reload with emulator running and verifying clean regeneration;
- reload with browser geolocation denied or delayed;
- location send after reload and matching map marker/API payload;
- logout API success and failure with populated driver order state;
- logging in as a different driver in the same browser context;
- preventing previous driver's selected order, modal, offer/voting state or notifications from appearing;
- driver finished-rating prompt/readback idempotency after reload.

No fresh Jest/TypeScript/Playwright run was performed in this stage. Historical results from prior stages do not establish these recovery cases.

## 8. Recommended implementation order

1. Implement an unconditional account-boundary reset for driver and passenger data, independent of remote logout API success.
2. Before exposing a newly authenticated user, clear old account order lists/details, selected-order state, modal state and user-scoped UI caches.
3. Confirm the intended order provider for a normal driver when emulator mode is disabled; add a production-config E2E proving active and ready orders appear.
4. Explicitly define real-driver recovery: backend order state + fresh GPS are authoritative; no emulator/demo marker snapshot may override them.
5. Define emulator reload behavior as a state machine: preserved running intent → re-authentication → geolocation → fresh emulator setup → healthy status. Show stopped/error when initialization fails.
6. Make location readiness explicit and gate trip actions until the map and backend location-sending path have a fresh position.
7. Make offer/voting simulation keys consistently user-scoped, expiring and resettable; distinguish simulation state from real backend state.
8. Add the missing driver reload, remount, GPS, account-switch and rating-readback E2E scenarios.

## 9. Files reviewed

- `taxi/src/pages/Driver/index.tsx`
- `taxi/src/pages/Driver/Orders.tsx`
- `taxi/src/pages/Driver/Map.tsx`
- `taxi/src/state/user/sagas.ts`
- `taxi/src/state/user/reducer.ts`
- `taxi/src/state/orders/reducer.ts`
- `taxi/src/state/orders/actionCreators.ts`
- `taxi/src/state/geolocation/actionCreators.ts`
- `taxi/src/state/geolocation/sagas.ts`
- `taxi/src/tools/driverOffer.ts`
- `taxi/src/appCache.ts`
- `taxi/e2e/README.md`

No application source files were modified. No PR was created.
