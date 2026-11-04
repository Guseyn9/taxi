# 02. API register and request-path audit

## 1. Scope

Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.

This pass inspected all files in `src/API/`, the shared `src/tools/api.ts` wrapper, and selected Redux/Gateway call sites. It is a source inspection; no backend request was executed and no production contract was verified.

## 2. Shared request wrapper

File: `src/tools/api.ts`

- `apiMethod` creates a new `FormData` for each wrapped method.
- Unless `authRequired: false`, it reads tokens from Redux and appends `token` and `u_hash`.
- Missing tokens cause an immediate rejected Promise with `Unauthorized user`.
- It passes the token, hash and FormData as the first internal argument to the implementation.
- It does not normalize Axios errors, impose timeouts, retry requests, or provide cancellation.

### Finding API-01 — falsy values are silently omitted

`addToFormData` skips every value for which `!value` is true. This includes numeric `0`, boolean `false` and empty string. It also skips `null` and `undefined`.

This helper is used for ordinary scalar fields as well as action parameters. A caller passing a meaningful zero/false value may silently send a request without that field. Examples that need a field-by-field review include:
- coordinates where zero is valid;
- flags such as `out_drive: '0'` (string zero is retained, but boolean false is not);
- numeric values such as passenger counts, waiting times, ratings or prices;
- optional values where omission and explicit empty value have different backend meanings.

**Severity:** potential high, scope-wide. The helper itself is confirmed; actual affected production requests must be established by tracing each call and its input type. Do not change this helper globally without contract tests.

## 3. API module register

### Authentication — `src/API/auth.ts`

| Export | HTTP request | Authentication | Notes |
|---|---|---|---|
| `register` | POST `/register` | No | Converts user fields; optional password serialized in `data`; driver adds `st=1` |
| `remindPassword` | POST `/remind` | No | Rejects on response status `error` |
| `login` | POST `/auth`, then POST `/token` | No | Handles wrong login/phone/password and code-sent responses; token exchange |
| `whatsappSignUp` | POST `/register` | No | Forces WhatsApp registration type and Client role; ignores supplied ref_code in request construction |
| `googleLogin` | POST `/register` or `/token`, then possibly `/token/authorized` | No | Two paths depending on auth_hash; logs auth object to console |
| `logout` | POST `/logout/?` | No | Does not append the FormData argument to request |

Observations requiring follow-up:
- `whatsappSignUp` accepts `ref_code` in its type but does not add it to FormData. Confirm whether referral attribution is expected on this path.
- `googleLogin` writes `console.log(auth)`; inspect whether the object can contain personal data or tokens before release.
- `logout` does not send the generated FormData; verify whether backend logout relies on cookies/session state or whether this is a stale endpoint.
- The login token exchange uses a separately created FormData and explicitly sets URL-encoded content type. Contract needs to be checked against the live backend.

### User — `src/API/user.ts`

| Export | HTTP request | Authentication | Response handling |
|---|---|---|---|
| `getUser(id)` | POST `/user/{id}` | Yes | Selects `data.user[id]`, converts user |
| `getUsers(ids)` | POST `/user/{ids joined by comma}` | Yes | Returns empty array if no user object; converts values |
| `getAuthorizedUser()` | POST `/user/authorized` | Yes | Uses first user object and converts it |
| `editUser(data)` | POST `/user` | Yes | Serializes reverse-converted user data |
| `editUserAfterRegister(data)` | POST `/user` | No | Same implementation, unauthenticated wrapper |

`editUser` accepts token/hash/id in the data object and appends them only when all three are truthy, while the wrapper normally adds current Redux credentials too. It removes `u_city` from the outer object and serializes it inside `data` when truthy.

### Cars — `src/API/car.ts`

| Export | HTTP request | Authentication | Notes |
|---|---|---|---|
| `createCar` | POST `/user/{u_id}/car` | Yes | Serializes car fields |
| `createUserCar` | POST `/car`; may then POST `/car/{id}` | Yes | Optional default intercity license setup |
| `getCar(id)` | POST `/car/{id}` | Yes | Converts one car |
| `getCars(ids)` | POST `/car/{ids joined by comma}` | Yes | Converts values from response |
| `getUserCars()` | POST `/user/authorized/car` | Yes | Returns raw car values |
| `getUserCar(id)` | POST `/user/{id}/car` | Yes | Adds `array_type=list`; returns first car or null |
| `editCar(id, fields)` | POST `/car/{id}` | Yes | Serializes fields |
| `driveCar(car)` | POST `/car/{c_id}/drive`; may POST `/user` | Yes | Treats already-driven/not-modified responses specially; then syncs user location classes |
| `getUserDrivenCar()` | POST `/user/authorized/car/driven` | Yes | Returns first car; assumes response has `data.car` |

Risk: `getCars` and `getUserDrivenCar` assume response subobjects exist; malformed/empty backend payload may throw instead of returning an empty result. Confirm expected backend schema and test empty results.

### Orders — `src/API/order.ts`

All listed mutations use POST `/drive/get/{id}` except creation and list retrieval. Most are authenticated through `apiMethod`.

| Export | Request | Function |
|---|---|---|
| `postDrive(order)` | POST `/drive` | Create order; retries b_options encoding in normal → array-values → omit modes for specific backend validation failures |
| `cancelDrive(id, reason)` | POST `/drive/get/{id}` | `set_cancel_state` |
| `getOrders(type, filter)` | POST `/drive`, `/drive/now`, or `/drive/archive` | Active, ready or history; optional filters |
| `getOrder(id)` | POST `/drive/get/{id}?fields=00000000u1` | Fetch and convert one order |
| `editOrder(id, data)` | POST `/drive/get/{id}` | `edit` action |
| `updateOrderCustomerPrice(order, price)` | POST `/drive/get/{id}` | Updates customer_price inside b_options |
| `takeOrder(id, options, candidate?)` | POST `/drive/get/{id}` | Assign performer; fetches current user's car first; records interaction |
| `sendOrderOffer(id, offer)` | POST `/drive/get/{id}` | Creates candidate offer; sends price and ETA/comment fields |
| `participateVotingOrder(id, price, eta)` | POST `/drive/get/{id}` | Adds voting candidate |
| `cancelVotingParticipation(id)` | POST `/drive/get/{id}` | Cancel-state action |
| `chooseCandidate(id, user)` | POST `/drive/get/{id}` | Sets performer=1 for selected user |
| `releaseCandidateChoice(id, user)` | POST `/drive/get/{id}` | Sets performer=0 for selected user |
| `setOrderState(id, state, driverCode?)` | POST `/drive/get/{id}` | Maps Arrived/Started/Finished to backend actions |
| `setOrderRating(id, value)` | POST `/drive/get/{id}` | Rate action |
| `setWaitingTime(id, previous, additional)` | POST `/drive/get/{id}` | Adds waiting time; default additional=180 |

Special behavior and risks:
- `getOrders` uses localStorage `hiddenOrders`, configured test-user IDs and browser-emulator state to filter orders client-side. Active orders are enriched with user data, converted, filtered by `b_confirm_state` and sorted.
- `getOrders(Ready)` maps backend errors `used car not found` and `empty driver location classes` to a typed detail `used_car_not_found`.
- `postDrive` may retry creation up to three times only when b_options validation errors match specific backend text. It may omit b_options on the final attempt. This compatibility behavior needs a backend contract test to ensure order creation does not lose required options.
- Voting creation calls `set_confirm_state` after order creation but catches and logs failure; order creation can succeed while this secondary action fails.
- `takeOrder` first reads the driver's car, then submits performer assignment. It retries without `b_driver_code` after selected errors. This is a multi-request mutation, not a single atomic frontend operation; server-side idempotency/duplicate behavior must be tested.
- `sendOrderOffer` includes ETA and comment in outer performer data but only `performers_price` in `c_options`. Comments explain that extra c_options keys may be rejected by the backend.
- `arrivedVotingOrder` and `confirmVotingCode` are local async stubs returning a synthetic `code: '200'`; they do not make an HTTP request. Their use must not be mistaken for backend confirmation.
- `setOrderState` rejects unsupported states; only Arrived, Started and Finished are mapped here.

### Location — `src/API/location.ts`

| Export | HTTP request | Authentication | Notes |
|---|---|---|---|
| `sendPosition({latitude, longitude})` | POST `/location` | Yes | Sends current coordinates |

This module is imported directly by `src/state/geolocation/sagas.ts`; it is not re-exported from `src/API/index.ts`. The direct import is valid but means the central API facade is not a complete inventory of API methods.

### Way and polygon — `src/API/way.ts`, `polygon.ts`

| Export | Request | Observed behavior |
|---|---|---|
| `getAreasIdsBetweenPoints(points)` | None | Always returns `[0]` |
| `getArea(id)` | GET `/mock/agadir.json` | Ignores id and returns static mock area |
| `getAreaFromXML(id)` | GET `/mock/agadir.osm` | Parses static OSM XML; not exported from central API facade |
| `getPolygonsIdsOnPoint([lat,lng])` | GET `{API_URL}/data?fields=map_place_polygons&key={lat},{lng}` | Returns keys of backend polygon object |

### Other methods in `src/API/index.ts`

| Export | Request | Notes |
|---|---|---|
| `uploadFile(data)` | POST `/dropbox/file` | Converts file to base64 JSON and sends with user id/private flag; unauthenticated wrapper, caller supplies token/hash |
| `checkRefCode(code)` | GET `/referral/code/{code}/check` | Unauthenticated |
| `checkConfig(config)` | GET API root with `config` query | Unauthenticated |
| `postTrip(data)` | POST `/trip` | Serializes trip |
| `getTrips(type)` | POST `/trip` | Authenticated; maps and sorts trips; type parameter is currently not used in request construction |
| `getWashTrips(type)` | POST `/trip/get` | Unauthenticated; maps and sorts trips; type parameter is currently not used in request construction |
| `getImageBlob(id)` | POST `/dropbox/file/{id}` | Returns object URL for blob |
| `getImageFile(id)` | POST `/dropbox/file/{id}` | Returns File from blob |
| `setOutDrive(isFinished, ...)` | POST `/user` | Sets/removes out-drive fields |
| `geocode(query, options)` | GET HERE or Nominatim | Direct external HTTP; no `apiMethod` wrapper |
| `reverseGeocode(lat,lng)` | GET HERE then Nominatim fallback | Cache and serialized request queue |
| `makeRoutePoints(from,to)` | External routing and fallback path | See route provider section below |
| `getPointSuggestions(...)` | HERE and/or Nominatim | Provider selection and fallback require detailed trace |
| `notifyPosition(point)` | POST `http://jecat.ru/car_api/api/notifypos.php` | Direct plain-HTTP external endpoint |
| `activateChatServer()` | GET `https://chat.itest24.com/wschat/checksrv.php` | Optional health check; enabled only by config |

## 4. Confirmed high-priority findings

### API-02 — Area routing is currently backed by mock data

**Observed in source:** `getAreasIdsBetweenPoints` always returns `[0]`; `getArea(id)` always fetches `/mock/agadir.json` and ignores the requested id. `getAreaFromXML(id)` reads `/mock/agadir.osm`.

**Call path:** `src/state/areas/sagas.ts` calls `API.getAreasIdsBetweenPoints` for `GET_AREAS_BETWEEN_POINTS_REQUEST`, then requests `API.getArea(id)` for any missing area. Therefore the mock behavior is not merely dead helper code: the Redux area-loading flow is wired to it.

**Impact:** any feature depending on real geographic area selection/road graph can receive a constant area id and static Agadir data, regardless of input points or requested area. This is a pilot blocker if those areas drive route calculation, service coverage, driver map behavior or pricing. Confirm which user flows request this Saga before assigning the exact business impact.

### API-03 — Voting arrival and code confirmation are synthetic success stubs

`arrivedVotingOrder` and `confirmVotingCode` return resolved `code: '200'` objects and perform no backend request. The caller/UI must be traced to determine whether these are intentionally local-only, emulator-only, or mistakenly treated as production confirmations.

**Severity:** high if reachable in normal pilot flows; otherwise technical debt/test stub.

### API-04 — Plain HTTP position notification endpoint

`notifyPosition` sends user id and coordinates to `http://jecat.ru/car_api/api/notifypos.php`. This is unencrypted transport and a separate domain. Call-site reachability and whether it is enabled in pilot builds must be established. If used with real driver locations, it is a security/privacy release blocker until removed or migrated to HTTPS with a documented purpose.

### API-05 — External API keys and provider fallback require deployment review

HERE key is resolved from site constants, runtime config or `REACT_APP_HERE_API_KEY`. The key is used directly in browser requests. This may be acceptable for a restricted public browser key, but allowed origins/scopes/quotas must be verified. Nominatim requests are rate-limited in client code, but that does not by itself establish compliance with the provider's usage policy or resilience under multiple clients.

### API-06 — Trip type arguments currently do not constrain retrieval

`getTrips(type)` and `getWashTrips(type)` accept an order type but the implementations shown do not use it to build the request. Verify whether the endpoint always returns the intended subset or whether callers believe the parameter filters server data.

## 5. Call-path evidence established in this pass

| Feature | UI/state entry | API method | Evidence |
|---|---|---|---|
| Create passenger order | `LegacyPassengerGateway` / orders thunk | `postDrive` | Gateway dispatches to backend API; thunk dispatches CREATE_SUCCESS |
| Load order areas | `state/areas/sagas.ts` | `getAreasIdsBetweenPoints`, `getArea` | Saga calls both in sequence |
| Resolve passenger pickup/dropoff | `state/clientOrder/sagas.ts` | `geocode`, `reverseGeocode`, `getPolygonsIdsOnPoint` | SET_FROM/SET_TO Saga |
| Send driver location | `state/geolocation/sagas.ts` | `sendPosition` | Direct import from API/location |
| Load wash trips | `components/Map/index.tsx` | `getWashTrips` | Called when map is open |
| Driver out-drive mode | `pages/Driver/Orders.tsx`, `TakePassengerModal` | `setOutDrive` | Gateway calls |
| Upload profile images | `ProfileModal`, user helpers | `uploadFile` | Upload helper and modal call sites |
| Chat health check | `App.tsx` | `activateChatServer` | Called at startup and every 30 seconds |

## 6. Test coverage status

This pass did not run tests. Repository search found:
- E2E fixture code that creates orders through the backend API independently of frontend API wrappers.
- Gateway unit tests mock API methods, which verify delegation but do not prove endpoint/payload compatibility.
- No test mapping has yet been established for the area mock behavior, voting stubs, API wrapper falsy handling, or trip-type filtering.

A dedicated API contract test matrix is required before pilot approval.

## 7. Next pass

1. Trace every exported API method to all UI/state callers and identify unreachable methods.
2. Inspect route calculation implementation in `makeRoutePoints` and `LegacyRouteProvider`, including ORS → local graph → OSRM fallback and configuration/key handling.
3. Map API methods to unit/E2E tests and identify missing payload/error assertions.
4. Inspect forms and validators for zero/false/empty values that interact with API-01.
