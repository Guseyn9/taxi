# 42. Backend location contract, driver-position readback and dispatch dependency

## Scope and evidence baseline

- Repository inspected: `Guseyn9/taxi`.
- Frontend source branch: `main`.
- Exact source commit: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.
- Audit branch: `audit/frontend-inventory`.
- Previous stage: [41 — Driver GPS acquisition, transmission and stale-position recovery](./41-driver-gps-acquisition-transmission-and-stale-position-recovery.md).
- Scope: trace the frontend-visible `POST /location` contract, authentication fields, `/drive/now` and active-order reads, driver coordinates and timestamp in order snapshots, passenger/driver consumers, and available live-backend evidence.
- **Critical access boundary:** the repository tree contains the React/TypeScript client, E2E fixtures and a driver emulator, but no PHP/backend implementation, database migrations or server-side dispatch source. Backend persistence, validation, freshness windows, expiry and dispatch SQL cannot be independently inspected here.
- No application source files changed. No tests were executed. No production API requests were made during this stage.

## Executive result

The frontend-visible contract establishes a two-step server interaction:

1. The driver (or test/emulator client) posts authenticated `latitude` and `longitude` to `POST /location`.
2. The driver asks for available orders through `POST /drive/now`; the frontend does not include coordinates in this request. It also reads active orders through `POST /drive`.

The emulator documentation explicitly warns that the backend may not return an order when the configured driver location is far from its pickup point. This is strong repository evidence that server-side order availability depends on the location previously registered for the driver. However, the backend implementation is absent, so the exact selection rule, distance threshold, timestamp update semantics and expiry behavior remain unverified.

The driver data contract includes `c_latitude`, `c_longitude` and `l_datetime` (documented as the date/time when the coordinates were received). The conversion layer parses `l_datetime` into a date value. Yet frontend consumers use the coordinates without checking `l_datetime`; no source usage of `l_datetime` for freshness, expiry or ordering was found.

**Conclusion:** location is part of the backend order-distribution contract, but the repository does not prove that stored positions are fresh or expire safely. This is a pilot-critical backend verification gap, not a confirmed backend defect.

## 1. Endpoint and authentication contract

### 1.1 Location update

Observed in source:

- `src/API/location.ts` exports `sendPosition()`.
- It adds exactly two fields to the request form: `latitude` and `longitude`.
- It posts to `${Config.API_URL}/location`.
- Its declared response type is `IResponse<'200', {}> | IResponse<'404', {}>`.
- The wrapper is created through the shared `apiMethod` helper; the E2E fixture explicitly supplies `token` and `u_hash` in the same request.
- The browser emulator and standalone driver emulator also post authenticated location updates to the same `/location` endpoint.

The inspected frontend payload does not include a client timestamp, accuracy, speed, heading, source identifier or monotonic sequence number.

### 1.2 Driver activation and location update are separate calls

The E2E helper `goOnline()` performs:

1. `POST /car/{c_id}/drive` to put the selected car into service.
2. `POST /location` with the supplied coordinate.

The standalone emulator README describes a similar preparation sequence: select/activate the car, activate the driver through `/user` with `u_active: 1`, then send location. This is emulator documentation, not a verified server specification.

### 1.3 Available-order query

Observed in source:

- `API.getOrders(EOrderTypes.Ready)` targets `POST /drive/now`.
- `API.getOrders(EOrderTypes.Active)` targets `POST /drive`.
- The frontend request to `/drive/now` does not add latitude/longitude or a location timestamp to the request body.
- Optional query filters are `b_car_classes` and `b_location_classes`; the ordinary ready-order saga calls `API.getOrders(EOrderTypes.Ready)` without passing either option.
- The response is converted into `IOrder[]`; active-order response also enriches the order with the corresponding user object.

**Implication:** if the backend filters available orders by driver location, it must obtain that position from server-side state (or another backend-side source), not from coordinates supplied with the current `/drive/now` request. The frontend source does not identify how that stored state is updated or expired.

## 2. Evidence that location affects order availability

### Observed repository documentation

`driver-emulator/README_RU.md` states that after a driver is put on line and location is posted, an order far from those coordinates may not be returned by the backend; it instructs the operator to configure the driver coordinates near the pickup point.

The same documentation describes the emulator regularly sending updated coordinates through `/location` while simulating a driver moving along an order route.

### What this proves and what it does not

- It is documented operational behavior of the gruzvill-compatible API used by this repository's emulator.
- It supports the conclusion that `/location` is not merely a map-display endpoint: the registered driver location can affect the server's ready-order response.
- It does **not** establish the exact radius, whether distance is straight-line or route-based, whether the server checks `l_datetime`, or whether a stale location is automatically expired.
- It does not prove that the Morocco pilot tenant uses identical configuration or server code.

## 3. Driver coordinates and timestamp in order snapshots

### 3.1 Data contract

`IDriver` in `src/types/types.ts` declares:

- `c_latitude` — driver latitude.
- `c_longitude` — driver longitude.
- `l_datetime` — date/time when the coordinates were received.

`convertDriver()` in `src/tools/convert.ts` converts the coordinates to numbers and parses `l_datetime` as a date. `convertOrder()` applies `convertDriver()` to every element of `order.drivers`.

Thus the frontend model is capable of receiving the server-provided location timestamp.

### 3.2 Timestamp is not used as a freshness gate

A repository search for `l_datetime` found its declaration and conversion configuration, but no runtime consumer that compares it with current time or rejects an old position.

Observed consumers use `c_latitude` and `c_longitude` directly:

- Driver Map resolves its backend position from coordinates in active-order driver records.
- Passenger map and candidate-related components calculate distances from driver coordinates to pickup.
- Voting and candidate UI derive driver distance/ETA from those coordinates.
- The type timestamp does not participate in those distance or position-selection paths.

The frontend therefore cannot distinguish a newly received driver position from an old one by using the available `l_datetime` field.

## 4. Stale-coordinate handling in the passenger map

`src/components/Map/index.tsx` contains a special fallback for an unconfirmed choice-order candidate:

- It calculates the distance from the backend driver's coordinates to pickup.
- If the point is more than 80 km away, it treats it as a clearly stale backend point.
- It generates a deterministic synthetic point near pickup for display and logs the rebase event.
- The returned driver object for this map path has its `c_latitude`/`c_longitude` replaced by the synthetic point.

This is explicitly described in source comments as protection against old test-driver coordinates from another city/country.

Important limits:

- This is a frontend display fallback for a choice-order map path, not a server-side location correction.
- It does not update `/location`, the backend driver record or the order snapshot.
- It does not use `l_datetime`; a stale point within 80 km is not caught by this distance-only rule.
- It can make the displayed marker look geographically plausible without proving the driver is actually there. The code logs the rebase, but downstream UI must not treat the synthetic point as a physical GPS fix.

## 5. Server-side dispatch and order lifecycle: what remains unknown

The frontend source establishes these facts:

- `/location` accepts a coordinate update request.
- `/drive/now` retrieves ready orders without including a coordinate in the request.
- Driver records embedded in order responses may contain coordinates and `l_datetime`.
- Frontend map and candidate components use those returned coordinates.
- The emulator documentation says location proximity can affect whether an order is returned.

The following backend details cannot be established from this repository:

1. Whether `/location` authenticates the token and `u_hash` against the same driver whose location is updated, and whether it rejects cross-user updates.
2. Whether latitude/longitude are range-checked and whether null, zero, malformed or impossible coordinates are rejected.
3. Whether each accepted update writes `l_datetime`, which clock it uses, and whether duplicate coordinates still refresh that timestamp.
4. Whether the server stores browser measurement time, server receive time, or both.
5. Whether there is a maximum allowed age for a driver location and how the driver is removed from dispatch when the location expires.
6. Whether `/drive/now` uses current location, last-known location, city/zone, car classes, location classes, active status or a combination.
7. Whether the distance threshold is configurable by tenant/city and whether it uses straight-line or road distance.
8. Whether an old location can survive logout, driver deactivation, car deactivation, another driver taking the same car, or a long network outage.
9. Whether active-order snapshots return a current driver position or a cached copy and what refresh interval governs it.
10. Whether arrival/start-state validation is performed against a trusted server-side location, a client-side check, or both.

No backend SQL, PHP route/controller, migration or dispatch implementation was present in the inspected repository tree. These items are **unverified**, not assumed absent.

## 6. Test evidence and gaps

| Evidence | What it demonstrates | What it does not demonstrate |
|---|---|---|
| E2E fixture `goOnline()` | A real test driver is activated and a single initial coordinate is posted to `/location` | Periodic location updates, stale expiry or dispatch behavior after movement |
| E2E browser context with geolocation | The browser can be assigned a deterministic GPS point for UI flows | That each browser fix reaches backend `/location` |
| TEST-E2E-010 documentation | Browser GPS is changed to destination to exercise the map's arrival/finish path | That backend stored location was updated to destination or used by server-side arrival validation |
| Driver-emulator README | The emulator regularly sends location updates and documents location-dependent ready-order discovery | The exact server filtering/expiry implementation or Morocco tenant parity |
| Driver type and converter | A timestamp field `l_datetime` is part of the response model and parsed | That the backend always supplies it or that its value is fresh/correct |
| Passenger map fallback | Very distant candidate coordinates are rebased for display | Correctness of real-time driver location or backend state |

No location-specific integration test was found that performs: send coordinate A → read back server driver record and timestamp → send coordinate B → verify server readback changes → verify ready-order selection follows B → stop updates → verify the location expires or the driver becomes unavailable.

No tests were run in this stage.

## 7. Required backend evidence for pilot acceptance

Request or inspect the actual backend source and produce evidence for each item:

1. **Endpoint implementation:** route/controller for `POST /location`, request validation, authentication and driver identity binding.
2. **Persistence:** exact table and columns updated, including coordinate and timestamp fields; transaction behavior; update result on duplicate/no-op coordinate.
3. **Freshness policy:** authoritative server receive timestamp, maximum age, expiry/availability transition and behavior after reconnect.
4. **Dispatch query:** `/drive/now` selection SQL/service, distance calculation, configurable radius, city/zone and vehicle-class predicates.
5. **Readback contract:** confirm that `/drive` and `/drive/get/{id}` return the same driver position and `l_datetime` semantics.
6. **Arrival authority:** confirm whether server validates arrival/start distance and which location record it trusts.
7. **Cross-tenant validation:** repeat the checks on the actual Morocco pilot tenant and its MAD/city/zone/taxi-class configuration.

### Minimal black-box acceptance sequence

Against an isolated pilot test driver and a controlled test order:

1. Activate the car and driver; send coordinate A through `/location`.
2. Read the driver's order snapshot and record `c_latitude`, `c_longitude`, `l_datetime`.
3. Move the driver far enough that the expected ready-order result changes; send coordinate B.
4. Read back the snapshot and prove the coordinates and timestamp advance.
5. Query `/drive/now` and prove the candidate order appears/disappears according to the documented location rule.
6. Stop sending updates; wait beyond the agreed freshness limit; prove the driver is no longer treated as currently located/available.
7. Reconnect and send a fresh point; prove location and availability recover.
8. Repeat with invalid coordinates, poor accuracy (if the contract later carries accuracy), duplicate points, expired auth, logout and account/car reassignment.

Capture request/response bodies with credentials redacted, server timestamps, driver ID, order ID, tenant, exact backend version and database readback.

## 8. Findings and pilot disposition

### UI-42-01 — Dispatch depends on a previously registered driver location, but the backend rule is unavailable for review

<badge color="danger">P1 · backend evidence required</badge>

**Evidence:** the ready-order request `/drive/now` carries no coordinates; emulator documentation states that a driver whose registered location is far from pickup may not receive the order.

**Risk:** a stale, missing or incorrectly associated server-side location can affect order visibility before the driver even sees a card. The exact server-side rule is not reviewable in this frontend-only repository.

**Disposition:** do not close until backend route/query source or a controlled tenant-backed black-box test demonstrates location update, dispatch selection and stale expiry.

### UI-42-02 — The response timestamp `l_datetime` is parsed but ignored by frontend location consumers

<badge color="warning">P1 · freshness contract gap</badge>

**Evidence:** `IDriver.l_datetime` and `convertDriver()` support the field; no consumer was found that checks its age. Passenger distance and Driver Map position selection use coordinates directly.

**Risk:** stale coordinates can influence candidate distance/ETA and map position without any client-side freshness warning. The 80 km map fallback only catches extreme displacement in one choice-order display path.

**Disposition:** define one authoritative freshness contract and apply it consistently. The backend should reject/expire stale operational positions; frontend should display stale/unavailable status instead of treating every returned coordinate as current.

### UI-42-03 — E2E proves initial location setup, not location update/readback/expiry

<badge color="warning">P1 · test coverage gap</badge>

**Evidence:** `goOnline()` posts one fixed coordinate; current E2E documentation does not establish a complete location lifecycle test with server readback and stale expiry.

**Risk:** existing order-flow E2E can pass while periodic GPS publication, backend timestamp refresh or stale-position expiry is broken.

**Disposition:** add the black-box acceptance sequence above and run it against the actual Morocco tenant.

## 9. Conclusion

**Backend location/dispatch contract: not verified; pilot gate remains open.**

The repository provides enough evidence to say that driver location is used by the server-side ready-order path, and that the response model carries a coordinate timestamp. It does not provide the server implementation needed to verify identity binding, storage, timestamp semantics, expiry, distance thresholds or dispatch correctness.

This is a hard evidence boundary, not a conclusion that the backend is defective. To complete the stage, the backend repository or equivalent route/controller/SQL artifacts and a controlled test tenant are required.

Next recommended stage 43: inspect the actual backend implementation of `POST /location`, `POST /drive/now` and driver coordinates in order snapshots. If the backend source is a separate repository, first identify and pin its exact repository, branch and commit; do not infer its behavior from the frontend client.
