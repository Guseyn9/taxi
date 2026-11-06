# 41. Driver GPS acquisition, transmission and stale-position recovery

## Scope and evidence baseline

- Source repository: `Guseyn9/taxi`
- Source branch: `main`
- Exact source commit: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf` (reconfirmed; unchanged from the pinned audit baseline).
- Audit documentation branch: `audit/frontend-inventory`
- Scope: browser geolocation acquisition, Redux geolocation state, driver location transmission, map position-source selection, persisted coordinates, lifecycle/recovery behavior and source-level tests.
- Cross-reference: stage 22 (driver reload/map recovery), stage 38 (polling/stale data), stage 40 (driver vehicle/capacity). This stage narrows the GPS path and does not repeat their broader findings.
- No application source files changed. No tests were executed.

## Executive result

The repository contains a browser geolocation pipeline and a `POST /location` API wrapper, but the source does **not** show a continuous production GPS publisher for an ordinary driver session. The main Driver page starts the location sender only behind the browser-emulator feature gate; the other observed activation sites are Voting-participant order surfaces. The normal driver map's own high-frequency browser GPS sampler is also emulator-gated, and the map container is passed `locate={false}`.

There is a separate stale-state defect: a failed browser position read dispatches `GET_FAIL`, but the geolocation reducer ignores that action. The previous successful fix remains selectable and the sending loop can post it again as if it were the latest position.

The frontend transmits only latitude and longitude to `/location`; it does not send the browser fix timestamp or accuracy. On the map, persisted browser coordinates and parked coordinates are read without applying their stored timestamps. Thus the source does not provide a freshness guarantee for all displayed/fallback positions.

**Pilot assessment: GPS/location distribution is not proven ready.** The standard-driver publication path and stale-fix behavior need explicit resolution and tenant-backed verification before relying on live driver coordinates for order distribution or arrival decisions.

## 1. Acquisition and state ownership

### 1.1 Redux geolocation pipeline

Observed in source:

- `src/tools/utils.ts` defines `HIGH_ACCURACY_GEOLOCATION_OPTIONS`: `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 15000`.
- `getCurrentPosition()` wraps `navigator.geolocation.getCurrentPosition`; it forces high accuracy even if callers pass another value.
- `src/state/geolocation/sagas.ts` runs a polling loop based on the smallest registered `WATCH` interval. It calls `getGeopositionSaga()` and dispatches either `GET_SUCCESS` or `GET_FAIL`.
- The reducer stores the full `GeolocationPosition` only on `GET_SUCCESS`. It has no `GET_FAIL` branch and no explicit stale/invalid state.
- `watch({ interval })` and `activateSending()` are separate thunks, each returning an unsubscribe/deactivate function.

### 1.2 Where the sender is activated

Observed in source:

- `src/state/orders/actionCreators.ts`: `watchReadyOrders()` registers geolocation at a 20-second interval and activates the sender; cleanup deactivates it and unregisters the watch.
- `src/pages/Driver/index.tsx`: the effects that call `watchReadyOrders()` and `watchActiveOrders()` return early unless the user is a Driver **and** `emulatorOrdersEnabled` is true. The same gate applies to history polling.
- `src/pages/Order/index.tsx`: a separate 3-second geolocation watch and sender activation exist while `isVotingParticipant` is true.
- `src/components/modals/CardModal.tsx`: the same 3-second watch/sender activation exists while the modal is active and the user is a Voting participant.

Implication: for the ordinary Driver page with emulator mode disabled, the main ready-orders watcher does not activate the `/location` sender. The other source-visible activation paths are conditional Voting flows. No general always-on or normal-driver availability publisher was found in the inspected frontend call paths.

This is a **source-level gap**, not proof that the backend never receives location by another mechanism. A backend-side or external publisher was not inspected in this frontend stage.

## 2. Transmission contract

Observed in source:

- `src/state/geolocation/sagas.ts` calls `sendPositionSaga()` after obtaining a position and then waits 20 seconds in the `whileWatching` loop.
- `src/API/location.ts` posts `latitude` and `longitude` as form data to `${Config.API_URL}/location`.
- No browser `timestamp`, `coords.accuracy`, altitude, heading or speed is included in this request.
- A non-`200` response is logged to the console; thrown request errors are also logged. No user-visible GPS/send health state is produced here.
- The `latestSent` value is returned from the sender but is not compared with the next fix to suppress or otherwise classify duplicate coordinates. The loop therefore sends the selected fix on each sending cycle.

Unverified:

- Whether the backend records its own receive timestamp, validates coordinate bounds/accuracy, rejects stale updates, associates the request with the authenticated driver, or expires old locations.
- Whether `/location` is the endpoint actually consumed by dispatch, map snapshots and arrival validation in the Morocco tenant.
- Whether a separate backend process or native client publishes locations outside these frontend call sites.

## 3. Confirmed findings

### UI-41-01 — Ordinary Driver session has no source-visible location publisher

<badge color="danger">P1 · pilot blocker pending backend proof</badge>

**Observed in source**

- The Driver page starts `watchReadyOrders()` only when `emulatorOrdersEnabled` is true (`src/pages/Driver/index.tsx`).
- `watchReadyOrders()` is the source path that activates the Redux geolocation sender (`src/state/orders/actionCreators.ts`).
- The sender's other inspected activations are Voting-participant effects in `pages/Order/index.tsx` and `components/modals/CardModal.tsx`.
- `Driver/Map.tsx` mounts `DriverOrderMapModeContent` with `locate={false}`. Its Leaflet `map.locate()` branch therefore does not run in this composition.
- The map's separate 1-second interval exits immediately unless `emulatorOrdersEnabled` is true; its direct browser GPS sampling is therefore emulator-only.

**Impact**

For a normal non-emulator Driver session, the inspected frontend does not establish periodic acquisition-and-publication of current GPS to `/location`. If dispatch or driver-position snapshots depend on that endpoint, coordinates may be absent or remain old. Do not assume the map's visual marker proves a live GPS feed: it can resolve from backend order coordinates, emulator movement or persisted parked position.

**Required evidence/remediation**

- Identify the authoritative production location publisher for an ordinary driver session.
- If the frontend is responsible, define its lifecycle independently of emulator mode and bind it to the driver's online/availability state.
- Add an integration test proving a non-emulator Driver obtains a fix, posts it, and the backend exposes the updated driver position to the relevant consumer.
- Verify that stopping availability, logout and account switch stop the old publisher.

### UI-41-02 — Failed GPS read leaves the previous fix active and eligible for retransmission

<badge color="danger">P1</badge>

**Observed in source**

- `getGeopositionSaga()` dispatches `GET_FAIL` on permission denial, timeout or other geolocation failure.
- The geolocation reducer handles only `GET_SUCCESS`; it does not clear the previous `geoposition`, record an error, or mark the value stale.
- `sendPositionSaga()` selects the reducer's current `geoposition` and sends it whenever present, without checking its timestamp or whether the latest acquisition succeeded.

**Impact**

After one successful fix followed by a failed acquisition, the old coordinates remain in Redux and can be posted again on a later sending cycle. The receiver cannot distinguish that repeated stale coordinate from a fresh device measurement based on the request payload, which contains only latitude and longitude.

**Required evidence/remediation**

- Represent acquisition status and fix freshness explicitly; a failed read must not silently preserve a value as current.
- Do not publish a fix after a failed/expired acquisition unless the API contract explicitly labels it stale.
- Test success → permission/error/timeout → send cycle, including the no-previous-fix case.

### UI-41-03 — Persisted map coordinates ignore their recorded age

<badge color="warning">P2 · stale display/recovery risk</badge>

**Observed in source**

- `saveLastBrowserGeolocation()` stores latitude, longitude, `timestamp` and source in `gruzvill_last_browser_geolocation`.
- `getSavedDriverMapPosition()` parses only latitude/longitude and returns the coordinate without checking the stored timestamp.
- `rememberDriverParkedPosition()` also stores a timestamp. `loadParkedDriverPosition()` reads only latitude/longitude.
- The map center fallback chain can use the parked position and then the saved browser geolocation. Neither persisted fallback has a maximum age or session/user identity in the stored shape.
- The parked position is also used by the shared driver-position helper and can survive reload.

**Impact**

An old stored coordinate can be restored as the map's initial center/parked point after a long offline period or on a later session in the same browser storage. This is not proof that the backend receives the old value, but it can make the UI present an old location as the driver's remembered position. Stage 22 covered map remount/reload; this stage confirms that the persisted timestamp is not used to enforce freshness.

**Required evidence/remediation**

- Define separate semantics for map-centering hints versus authoritative current driver position.
- Apply a documented maximum age to persisted GPS/parked values; expire or label stale values.
- Scope persisted operational position to the authenticated driver/session and clear it at identity changes where appropriate.
- Test reload after short and long offline intervals and same-browser account switching.

### UI-41-04 — GPS quality and freshness are not represented in the location request

<badge color="warning">P1 · backend contract required</badge>

**Observed in source**

- The browser fix contains `coords.accuracy` and a browser timestamp, but `src/API/location.ts` sends only latitude and longitude.
- The location reducer stores the full browser object locally, but the API wrapper drops all fields except those two coordinates.
- No frontend freshness threshold or accuracy threshold is applied in the Redux send path.

**Impact**

The frontend request contract does not let the backend distinguish a high-quality recent fix from a low-accuracy or delayed fix unless the backend independently supplies equivalent metadata. A successful HTTP response alone does not establish coordinate quality.

**Required evidence/remediation**

- Agree whether backend receives authoritative timestamp/accuracy or calculates/records an equivalent server-side quality signal.
- Define thresholds for stale fixes, poor accuracy and impossible jumps; do not silently treat a low-quality fix as precise.
- Add tests for boundary coordinates, poor accuracy, stale timestamp and rapid source changes.

### UI-41-05 — Emulator GPS sampler can retain an old point after a large jump or repeated failures

<badge color="warning">P2 · emulator/test-path limitation</badge>

**Observed in source**

- The Driver map's 1-second timer runs direct `navigator.geolocation.getCurrentPosition()` only when emulator orders are enabled and the driver emulator is not active.
- It prevents overlapping requests and skips requests while `document.hidden`.
- A new fix more than 450 metres from the previous point is discarded. The previous point remains in `lastPositions`; subsequent points are still compared against that same retained point.
- Geolocation errors are logged and clear the in-flight flag, but do not clear `lastPositions` or emit a location-lost event.
- This sampler does not pass the fix's timestamp or accuracy into the shared position bus.

**Impact**

A rejected large jump can leave the marker anchored to the old point; if subsequent fixes remain beyond the 450 m threshold, the sampler can continue rejecting them. This path is emulator/test-mode-only in the inspected composition and should not be mistaken for a production GPS safeguard.

**Required evidence/remediation**

- Decide whether a large jump is a rejected outlier, a source reset or a legitimate relocation; avoid a permanent lockout against the last accepted point.
- Record acquisition failure and accepted/rejected fix metadata.
- Test one outlier followed by valid fixes, hidden-tab pause/resume and permission denial/regrant.

## 4. Permission, browser lifecycle and recovery

Observed in source:

- Geolocation uses the browser callback API with a 15-second timeout and high accuracy.
- The inspected frontend does not query `navigator.permissions` for geolocation state and does not expose a distinct permission-denied/permission-revoked UI state.
- The Redux sender's geolocation polling loop has no explicit `visibilitychange`, `pageshow`, `online` or focus recovery logic. It waits on its interval and relies on the browser geolocation request to complete or time out.
- The emulator map sampler explicitly skips hidden documents. The generic `useInterval` helper has focus/pageshow/visibility wake handling, but the GPS acquisition logic still refuses to request while hidden.
- No source-level retry/backoff policy for `POST /location` is visible. A failed send is logged; the next loop may try again with whatever fix remains in Redux.
- The inspected test inventory contains `driverLocationLog.test.ts`, which tests diagnostic event sampling/source changes/loss records, not browser permission, geolocation acquisition, the Redux sender or backend location readback.

Runtime behavior after browser permission revocation, Android background suspension, device location-service shutdown, reconnect, and low-accuracy GPS remains **unverified**.

## 5. Location sources and what they actually prove

The Driver map's marker resolver prefers emulator route position, then restored emulator position, then parked position in emulator mode, then browser GPS/backend coordinates according to mode. The backend driver coordinate is derived from active-order driver records (`driver.c_latitude`, `driver.c_longitude`). The map publishes the resolved marker position through `driverPositionChanged` for order-detail arrival checks.

Important distinction:

- `EMULATOR_ROUTE`, `EMULATOR_RESTORED` and `PARKED` are not fresh device GPS measurements.
- `BACKEND` means a coordinate was present in an active-order driver record; the frontend does not know its server-side measurement age.
- `BROWSER_GPS` means a browser GPS coordinate was accepted by the map path; the shared position bus does not carry the original browser accuracy/timestamp.
- A marker being visible or an arrival radius check passing is not proof that the backend recently received a trustworthy physical GPS fix.

The arrival helpers use a 100-metre radius for pickup and destination. Their correctness in production therefore depends on the freshness and authority of the selected position source, not just the distance calculation.

## 6. Test and evidence coverage

| Area | Source evidence | Execution |
|---|---|---|
| Browser geolocation options/wrapper | `tools/utils.ts` | Not executed |
| Redux acquisition/sending saga | `state/geolocation/sagas.ts` | No dedicated geolocation saga test found |
| Reducer failure/stale behavior | `state/geolocation/reducer.ts` | No dedicated reducer test found |
| `POST /location` payload | `API/location.ts` | No dedicated API contract test found |
| Driver page publisher activation gate | `pages/Driver/index.tsx`, `state/orders/actionCreators.ts` | Source-only |
| Voting publisher activation | `pages/Order/index.tsx`, `components/modals/CardModal.tsx` | Source-only |
| Map source resolution / GPS sampling | `pages/Driver/Map.tsx` | Source-only |
| Diagnostic source-change/loss logging | `tools/driverLocationLog.test.ts` | Test exists; not executed |

No Jest, TypeScript, build or E2E command was run for this stage.

## 7. Pilot acceptance gates

Before accepting GPS as an operational dependency:

1. Demonstrate a normal non-emulator Driver session continuously publishes location while online, independent of Voting and emulator flags.
2. Prove that permission denial, timeout, stale fix and network failure are visible as distinct states and never silently masquerade as a fresh position.
3. Confirm the backend contract for identity binding, timestamp, accuracy, stale-update rejection and location expiry.
4. Verify that dispatch and map consumers use the same authoritative driver location and can detect its age.
5. Exercise real Android devices in foreground, background/resume, permission revoked/regranted, GPS disabled/enabled, airplane/offline/reconnect and poor-accuracy conditions.
6. Verify account switch/logout cannot restore another driver's persisted operational position.
7. Add regression tests for acquisition failure after success, no initial permission, repeated timeout, POST failure, stale cache expiry and large-jump recovery.

## 8. Conclusion

**GPS/location distribution: not accepted for pilot on frontend evidence alone.**

The most important unresolved point is not map rendering; it is whether a normal available driver session publishes fresh coordinates at all. The visible frontend activation chain is emulator-gated on the Driver page, with additional conditional Voting paths. In addition, failed acquisition preserves the last successful Redux fix, and persisted display coordinates have no age check.

Next recommended stage 42: trace the complete backend consumer chain for `POST /location` — authentication/driver binding, database fields, freshness/expiry, dispatch candidate selection, active-order snapshots and arrival-state authority — then compare it with the frontend publisher findings in this report.
