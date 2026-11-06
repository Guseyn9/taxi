# 39. Session restoration, reload and account isolation

## Scope and baseline
- Repository: Guseyn9/taxi
- Source baseline: main at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Method: static tracing of app startup, token persistence, user initialization, login/logout reducers and sagas, role page watchers, order/car/client-order reducers, Platform Interface provider lifecycle, and existing E2E setup/spec references.
- No application source changed. No tests executed.

## Executive result
Authentication token restoration exists: on app mount `INIT_USER` reads `state.user.tokens`, validates token presence, calls `getAuthorizedUser`, then installs the user. The Redux order state itself is not persisted; it must be reloaded by role-page watchers. However, account transitions do not have a comprehensive client-state reset. In particular, login start clears only the user/tokens slice, and logout clears order lists only after the remote logout request succeeds. This creates a credible cross-account stale-state window and a logout-failure path that retains old order data.

## UI-39-01 — Login does not clear previous account's domain state
**Severity: P1; potential P0 if sensitive order data is exposed before the first successful refresh.**

Files: `src/state/user/reducer.ts`, `src/state/user/sagas.ts`, `src/state/rootReducer.ts`, `src/state/orders/reducer.ts`, `src/state/cars/reducer.ts`.

Observed:
- `LOGIN_START` sets user and tokens to null, but does not dispatch a global reset or `clearOrders()`.
- `LOGIN_SUCCESS` installs the new user and tokens; no domain-state reset is part of this transition.
- `rootReducer` combines independent user, cars, orders, order details, client-order, geolocation, modal and other slices. There is no root-level account-change reset.
- The orders reducer has a dedicated `CLEAR` action, but it is not tied to `LOGIN_START` or `LOGIN_SUCCESS`.
- The cars reducer has no clear action in its action constants/reducer; `userCars` and cached car records remain until replaced by a successful `GET_USER_CARS_SUCCESS`.
- Driver page requests cars and starts active/ready/history watchers when the new user is a driver. These are asynchronous refreshes; they do not synchronously erase the previous account's state.

Consequence: if a user logs out/in or changes account in the same running SPA, previous order/car data can remain in Redux while the new account's first requests are pending. Which parts are visible depends on route/component lifecycle and selectors; cross-account display was not runtime-tested. This is a client-side isolation defect candidate, not evidence that backend authorization is bypassed.

Recommendation: introduce an explicit account-session boundary. On identity change, synchronously clear all user-owned slices (orders, cars, order details, selected order, passenger draft fields that are account-specific, modal/transient workflow state and in-memory emulator markers) before rendering the new role surface. Key async responses by user/session generation and discard responses started under the previous identity.

## UI-39-02 — Logout cleanup depends on successful backend logout
**Severity: High.**

File: `src/state/user/sagas.ts`.

Observed sequence:
1. `logoutSaga` dispatches `LOGOUT_START`; the user reducer immediately clears user and tokens.
2. It removes `state.user.user` and `state.user.tokens` from localStorage.
3. It calls `API.logout`.
4. Only after that call succeeds does it dispatch `LOGOUT_SUCCESS` and `clearOrders()`.
5. If the network/backend logout call rejects, the catch dispatches `LOGOUT_FAIL`; `clearOrders()` is never dispatched.

Thus a network failure during logout leaves prior order data in Redux after the local user and token have already been cleared. A later login in the same SPA can encounter that data (see UI-39-01). Local logout must not depend on remote logout availability.

Recommendation: perform local teardown in a `finally` path or immediately at logout start, independently of the remote revoke call. Report remote revocation failure separately; clear local session data regardless.

## UI-39-03 — Reload restores identity, not the active order workflow
**Severity: P1; expected behavior needs product confirmation.**

Files: `src/App.tsx`, `src/state/index.ts`, `src/state/user/sagas.ts`, `src/state/orders/reducer.ts`, `src/state/clientOrder/reducer.ts`, `src/pages/Driver/index.tsx` and passenger page.

Observed:
- Redux store is created from `rootReducer` without a persistence/re-hydration enhancer.
- `App` dispatches `initUser()` on mount. `initUserSaga` reads localStorage tokens, calls `getAuthorizedUser`, and sets the user after the request succeeds.
- Orders are held in Redux and the orders reducer's `CLEAR` resets list IDs and nulls cached values; there is no durable order-state persistence in the store.
- Driver role page starts order watchers and loads user cars after the restored user is available.
- Passenger page uses active-order polling and in-memory selected-order state; the `clientOrder` reducer persists selected form inputs such as pickup/dropoff/time/phone, but not the active selected order as an authoritative recoverable order session.

Result: after reload, login can be restored, but active order state and selected workflow must be rediscovered from backend and rebuilt by the role page. The code does not establish that a driver returns directly to the exact active order/card/action step, or that a passenger's selected active order is automatically reselected. That behavior remains unverified.

Recommendation: define reload acceptance per role. Driver: restore active trips by fetching authoritative active orders and selecting the current driver's active trip. Passenger: fetch active orders and reconcile the previous order identifier (if persisted safely) against server ownership/status before restoring selection. Never restore action permissions from local storage alone.

## UI-39-04 — Passenger draft fields are persisted globally, not scoped to an account
**Severity: Medium; privacy/product decision required.**

File: `src/state/clientOrder/reducer.ts`.

Observed:
- Initial state reads pickup, destination, time and phone from fixed localStorage keys under `state.clientOrder.*`.
- Those keys are not namespaced by user ID or role in the reducer.
- The passenger draft reducer is independent of login/logout lifecycle and is not cleared by `clearOrders()`.

Potential consequence: on a shared browser/device or account switch, a subsequent account can inherit the previous account's phone number and trip draft. This may be intentional convenience for a single-user device, but it is not account isolation.

Recommendation: decide explicitly which fields are device preferences versus account data. Scope phone and any personal trip draft to the authenticated user, or clear them on identity change. Pickup/time preferences may remain device-scoped only if that is a deliberate product rule.

## UI-39-05 — Platform Interface provider changes with identity, but does not itself prove workflow restoration
**Severity: Medium / evidence gap.**

Files: `src/App.tsx`, `src/platform/platform-interface/PlatformInterfaceRuntime.ts`, `src/platform/adapters/LegacyReduxSnapshotProvider.ts`, `src/platform/adapters/FsmDriverSnapshotTransport.ts`, `src/platform/adapters/FsmOrderSnapshotTransport.ts`.

Observed:
- App selects the driver FSM snapshot provider for a driver; otherwise it selects configured order FSM provider or legacy Redux provider.
- Provider selection effect is keyed by `user.u_id` and `user.u_role`, so identity/role changes trigger provider replacement.
- `PlatformInterfaceRuntime.stop()` unsubscribes the current provider and preserves the last snapshot in runtime state while setting status to Stopped.
- `start()` subscribes and refreshes; snapshots are delivered from the selected provider.
- FSM snapshot transports guard against stale query responses using query sequence, realtime epoch and server revision/updatedAt.

Not established:
- Whether `SwitchableSnapshotProvider.setProvider()` fully invalidates in-flight results from the previous account.
- Whether all provider/runtime snapshots are cleared or safely replaced on logout/account switch.
- Whether an old order snapshot can transiently be rendered while a new account provider is loading.

Recommendation: verify provider generation fencing. On account change, invalidate prior provider requests, clear account-owned snapshots, and require snapshot identity (driverUserId/order ownership) to match the active session before applying it.

## UI-39-06 — E2E evidence does not currently establish reload/account-switch acceptance
Files: `e2e/auth.setup.ts`, `e2e/fixtures/appShell.ts`, `e2e/README.md`, `e2e/trip-interruption.spec.ts`.

Observed:
- E2E setup signs in through the real form and saves browser `storageState` after verifying `state.user.tokens` exists.
- `appShell.ts` may reload the page as an app-boot retry; that is not a dedicated session-restoration assertion.
- E2E README mentions a passenger-after-reload expectation in the context of AC-09, but the repository search did not identify a dedicated executable test that performs reload and asserts restored authenticated workflow.
- Existing E2E suites use separate browser contexts for passenger and driver, which tests cross-role concurrency but not switching two identities inside one browser context.

Classification: authentication setup is observed in source; a successful reload restoration test and same-context account-switch isolation test were not found in the inspected E2E suite. No test execution was performed.

## Evidence classification
| Claim | Classification |
|---|---|
| Tokens are restored from localStorage and user revalidated through API | Observed in source |
| Redux store is created without persistence enhancer | Observed in source |
| LOGIN_START does not clear domain slices | Observed in source |
| Logout only clears orders after successful API.logout | Observed in source |
| Passenger draft fields use fixed, non-user-scoped keys | Observed in source |
| A stale order/car is actually displayed to a second account in a browser | Not tested |
| Reload restores active driver/passenger workflow correctly | Unverified |
| Previous provider snapshot can render after account switch | Unverified |
| Dedicated executable same-context account-switch E2E exists | Not found in inspected E2E references |

## Remediation order
1. **P0/P1:** implement a single `SESSION_IDENTITY_CHANGED` teardown/reset that runs synchronously before installing a different user; include orders, cars, order details, selected order, passenger account-specific draft and transient state.
2. **P0/P1:** make logout local teardown unconditional and independent of `API.logout` success.
3. **P1:** fence all asynchronous requests/snapshots by session generation or user ID so old-session responses cannot repopulate new-session state.
4. **P1:** implement role-specific reload recovery from authoritative backend state; do not rely on local optimistic state.
5. **P1:** add same-context account-switch E2E: account A with active order → logout under simulated API failure → account B login → assert no A order/car/phone/snapshot is visible or actionable.
6. **P1:** add reload E2E for driver active trip and passenger active order; assert server state and rendered UI converge after reload and reconnect.
7. **P2:** classify localStorage fields as device-scoped preferences or user-scoped data and apply the chosen policy consistently.

## Pilot disposition
**NO-GO** for multi-account/shared-device acceptance until UI-39-01 and UI-39-02 are fixed and same-context isolation is tested. Reload-based active-order recovery remains an explicit acceptance gap. The current source does restore authentication credentials, but that alone is not proof of restoring the active taxi workflow.

No application source, tests, CI workflow or runtime configuration were changed. No Jest, TypeScript, build or E2E execution was performed.

## Evidence links
- [App startup and provider selection](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/App.tsx)
- [User sagas](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/user/sagas.ts)
- [User reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/user/reducer.ts)
- [Root reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/rootReducer.ts)
- [Store initialization](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/index.ts)
- [Orders reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/reducer.ts)
- [Cars reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/reducer.ts)
- [Passenger draft reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/clientOrder/reducer.ts)
- [Driver page watchers](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/pages/Driver/index.tsx)
- [E2E authentication setup](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/auth.setup.ts)
- [E2E app shell](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/fixtures/appShell.ts)