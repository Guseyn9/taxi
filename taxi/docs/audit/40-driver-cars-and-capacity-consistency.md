# 40. Driver cars, active vehicle selection and capacity consistency

## Scope and baseline
- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: car API, Redux/Saga cache, profile editing/creation, primary-vs-driven car selectors, driver order list/map capacity filtering, and ready-order auto-drive behavior.
- Method: static source tracing and inspection of existing Jest test source.
- No application source changed. No tests executed.

## Executive result
The frontend maintains two different notions of the driver's vehicle: the first/primary car and the car the backend marks as currently driven. Driver list/map capacity calculations use the driven car, but the ready-order recovery path and live profit estimator use the primary car. In addition, the cars saga suppresses repeated car-list loads for the same user for the lifetime of the SPA. Since logout does not clear this saga-local deduplication key or the cars Redux slice, logging back into the same account can leave the app using stale car data and skip the intended reload.

## UI-40-01 — Primary and currently driven car are used inconsistently
**Severity: P1.**

Files:
- `src/state/cars/selectors.ts`
- `src/state/orders/sagas.ts`
- `src/state/orders/selectors.ts`
- `src/tools/liveOrderProfit.ts`
- `src/pages/Driver/index.tsx`
- `src/pages/Driver/Orders.tsx`
- `src/pages/Driver/Map.tsx`

Observed:
- `userPrimaryCar` always selects the first ID in the backend-returned `userCars` list.
- `userDrivenCar` searches that list for a car whose `u_d_id` matches the current user ID, but falls back to the first car when no match exists.
- Driver page, list and map obtain `userDrivenCar`; order capacity filtering therefore uses the driven car (including its seat count/class).
- `drivePrimaryCarSaga`, triggered after `getOrders(EOrderTypes.Ready)` returns `used_car_not_found`, selects `userPrimaryCar` and sends that car to `driveCar`.
- `useLiveEstimatedOrders` also uses `userPrimaryCar` for profit estimates, while driver UI capacity uses `userDrivenCar`.

Consequence:
If a driver owns multiple cars and a non-first car is the one currently driven, the order-recovery path can attempt to put the first car into service instead of the already-selected/current vehicle. Profit estimates can be calculated with a different vehicle's class/capacity/parameters than the one used by the list/map capacity gate. Whether backend allows multiple simultaneous driven cars and how it orders the car list require backend confirmation; the frontend inconsistency itself is observed.

Recommendation:
Define one canonical selector/contract for the active vehicle. Use the backend-confirmed driven car for all runtime calculations and drive recovery. If no driven car exists, present an explicit vehicle selection/activation step rather than silently substituting the first car. Do not treat list order as a business rule.

## UI-40-02 — Same-user car-list reload can be suppressed after logout/login
**Severity: P1.**

Files:
- `src/state/cars/sagas.ts`
- `src/state/cars/reducer.ts`
- `src/pages/Driver/index.tsx`
- `src/state/user/sagas.ts`

Observed:
- `cars.sagas` creates a saga-local `loadState.lastUserId` once when the saga starts.
- For `GET_USER_CARS_REQUEST`, `getUserCarsSaga` returns immediately when there is no user ID or when the current ID equals `lastUserId`.
- The key is updated after a successful `GET_USER_CARS_SUCCESS`.
- The key is not reset by logout, `GET_USER_CARS_FAIL`, or any cars reducer action.
- The cars reducer has no CLEAR action. Logout clears user/token storage and order lists on the success path, but does not clear the cars slice.
- Driver page dispatches `getUserCars()` on mount/user identity effect; after logout and login to the same user within the same SPA runtime, this request can be skipped by the still-matching `lastUserId`.

Consequence:
If the car was changed outside this SPA, the driven car changed on the backend, or the prior load is stale, the same-account re-login does not guarantee a fresh car list. The stale Redux car list can continue to drive the car selector and order-capacity decisions. This compounds the account/session teardown gaps in stage 39.

Recommendation:
Make car-list loading explicitly refreshable. Reset the deduplication state on logout/session generation change, or key it by session generation and provide a forced refresh path. Clear the cars slice on identity teardown. A failed request must remain retryable.

## UI-40-03 — Capacity fallback silently assumes four seats
**Severity: Medium; backend/data-contract confirmation required.**

File: `src/tools/driverCapacity.ts`.

Observed:
- Capacity uses positive integer `car.seats`, then the configured `SITE_CONSTANTS.CAR_CLASSES[car.cc_id].seats`, then `DEFAULT_CAR_SEATS = 4`.
- A missing, zero, malformed or unknown vehicle capacity therefore becomes four seats.
- Both driver list and map use this derived capacity to filter orders.

Consequence:
A vehicle with missing or unrecognized seat data may be treated as a four-seat vehicle. That can expose orders the actual vehicle cannot carry, or hide valid orders if the configured class is wrong. The fallback is a deliberate source-code default, but there is no evidence in the frontend that four seats is a safe Morocco-wide fallback for all vehicle classes.

Recommendation:
For production/pilot, require validated capacity from the vehicle or a known car class. If unavailable, fail closed for orders with more than one passenger and show a data-quality warning; do not infer a four-seat vehicle without a verified business rule. Confirm class/seat mappings for the Morocco tenant.

## UI-40-04 — Creating a car and refreshing the list are not awaited as one operation
**Severity: Medium.**

Files:
- `src/components/modals/ProfileModal.tsx`
- `src/state/cars/actionCreators.ts`
- `src/state/cars/sagas.ts`

Observed:
- Profile form awaits `createUserCar`, then dispatches `getUserCars()` without awaiting the resulting saga/API refresh.
- `createUserCar` dispatches `CREATE_USER_CAR_SUCCESS` after successful creation; the cars saga also treats that action as a latest-trigger to fetch the list.
- The profile form can continue to update user data and show a success message before the refreshed car list is confirmed.
- The profile modal's selected car is `userPrimaryCar`, i.e. first car in the list, not necessarily the car currently driven.

Consequence:
The user-facing success of the profile submission is not proof that the newly created car has appeared in the Redux list or is the car selected for runtime use. The explicit `getUserCars()` dispatch may also be redundant with the `CREATE_USER_CAR_SUCCESS`-triggered fetch; the concurrency policy and exact race outcome require runtime/test evidence.

Recommendation:
Use one refresh trigger after successful creation and expose a loading/error state until the new car is present in the authoritative list. Define whether profile editing targets primary car or driven car and label that behavior explicitly.

## UI-40-05 — Car update refreshes one record, but does not reconcile the active vehicle/user profile contract
**Severity: Medium.**

Files:
- `src/state/cars/actionCreators.ts`
- `src/state/cars/sagas.ts`
- `src/API/car.ts`
- `src/components/modals/ProfileModal.tsx`

Observed:
- Car edit thunk dispatches START_MUTATION, calls `API.editCar`, then always dispatches END_MUTATION.
- `END_MUTATION` triggers `getCarSaga`, which reloads the individual car by ID.
- `driveCar` calls the car drive endpoint and, on success/already-driven response, calls `syncUserWithCar` to update the user's `b_location_classes` based on the selected car class.
- The drive thunk's END_MUTATION refreshes the car record only; it does not refresh the user object after `syncUserWithCar`.
- The profile flow calls `initUser` after user profile updates, but car edit alone does not refresh user data.

Consequence:
After changing the driven vehicle/class, car details are reloaded, but the client-side user object is not necessarily refreshed to reflect the updated location-class restrictions sent by `syncUserWithCar`. Whether any visible screen relies on stale `u_* ` fields for this setting requires additional call-site tracing; backend state remains authoritative and is not independently verified here.

Recommendation:
After successful vehicle activation, reconcile both the car and user from backend, or return a single canonical activation response containing both. Avoid partially successful UI state if car activation succeeds but user synchronization fails.

## Existing test coverage and evidence
- `src/state/orders/__tests__/readyOrdersPolling.test.js` exercises the `used_car_not_found` recovery path and mocks only `userPrimaryCar`; it does not distinguish primary from backend-driven vehicle or test multiple cars.
- The test suite contains scenarios for loading a missing primary car and for already-driven responses. It does not establish correctness of primary-vs-driven selection.
- The inspected `driverCapacity` helper is a pure calculation used by driver list/map, but no matching dedicated test file was found in the repository search performed for this stage.
- Tests were not executed.

## Evidence classification
| Claim | Classification |
|---|---|
| Primary car is first item in `userCars` | Observed in source |
| Driven car is found by matching `u_d_id`, with first-car fallback | Observed in source |
| Driver list/map capacity uses driven car | Observed in source |
| Ready-order recovery activates primary car | Observed in source |
| Profit estimator uses primary car | Observed in source |
| Same-user request is skipped after successful prior load | Observed in source |
| Logout does not clear car slice or saga-local lastUserId | Observed in source |
| Actual wrong car is activated in production | Not tested |
| Backend supports multiple simultaneously driven cars | Unverified |
| Four-seat fallback is valid for all Morocco vehicle classes | Unverified |
| User-visible stale location-class behavior occurs after activation | Not tested |

## Remediation order
1. **P1:** unify all runtime paths on the canonical backend-confirmed driven car; remove implicit first-item activation.
2. **P1:** clear car cache and reset/re-key the load deduplication state on logout/account-session change; provide forced refresh.
3. **P1:** test multiple-car behavior with a non-first active car, including ready-order recovery, list/map capacity, and profit calculation.
4. **P1:** validate car class and seat capacity against Morocco tenant configuration; remove or constrain unsafe four-seat fallback.
5. **P2:** make car creation/profile save await authoritative car-list reconciliation and avoid duplicate refresh dispatch.
6. **P2:** reconcile user profile data after vehicle activation and test partial-failure behavior of car drive plus user sync.

## Pilot disposition
**NO-GO** for multi-vehicle driver acceptance until UI-40-01 and UI-40-02 are resolved and tested. Seat capacity also needs an explicit verified rule for the Morocco pilot. This is a frontend source assessment; backend multi-car semantics and live tenant data were not available for verification.

No application source, tests, CI workflow or runtime configuration were changed. No Jest, TypeScript, build or E2E execution was performed.

## Evidence links
- [Car API](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/API/car.ts)
- [Car actions](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/actionCreators.ts)
- [Car selectors](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/selectors.ts)
- [Car sagas](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/sagas.ts)
- [Car reducer](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/cars/reducer.ts)
- [Driver capacity calculations](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/driverCapacity.ts)
- [Ready-order recovery](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/sagas.ts)
- [Driver list](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/pages/Driver/Orders.tsx)
- [Driver map](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/pages/Driver/Map.tsx)
- [Profile modal](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/components/modals/ProfileModal.tsx)
- [Ready orders polling tests](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/state/orders/__tests__/readyOrdersPolling.test.js)
