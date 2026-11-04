# 01. Frontend inventory and coverage map

## 1. Scope and reproducibility

| Field | Value |
|---|---|
| Repository | `Guseyn9/taxi` |
| Baseline branch | `main` |
| Baseline commit | `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf` |
| Application root | `taxi/` |
| Source root | `taxi/src/` |
| Audit branch | `audit/frontend-inventory` |

The recursive Git tree for the pinned `main` commit was retrieved successfully (`truncated: false`). It contains 626 files under `taxi/src/`. This is a source-tree inventory, not a runtime audit.

The following branch is deliberately excluded: `review/10-qa-review`. Findings from it must not be attributed to `main`.

## 2. Directory inventory

Counts below are files under the named source directory (recursive). Directory totals overlap only where a parent directory is counted; the listed rows are separate top-level areas.

| Area | Files | Coverage / purpose |
|---|---:|---|
| `src/API/` | 10 | Legacy HTTP API modules and exports |
| `src/state/` | 74 | Redux state, reducers, actions, selectors, Saga/Thunk |
| `src/pages/` | 16 | Route-level screens |
| `src/components/` | 196 | Reusable UI, forms, maps, modals |
| `src/platform/` | 90 | Platform Interface, interaction contracts, adapters and channels |
| `src/tools/` | 78 | Shared utilities, mapping and business helpers |
| `src/types/` | 8 | Shared TypeScript types |
| `src/constants/` | 12 | Constants |
| `src/localization/` | 4 | Localization |
| `src/assets/` | 49 | Static assets |
| Other source paths | 89 | Remaining source files not in the listed top-level areas |
| **Total** | **626** | |

Test files found under `src/`: **51**. Playwright E2E specifications found under `taxi/e2e/`: **12**. These are file counts only; no test run is claimed by this inventory.

## 3. Page and route areas

Observed page-level areas include:

- `src/pages/Driver/` — driver workspace, map and order lists.
- `src/pages/Passenger/` — passenger order flow and voting form.
- `src/pages/Order/` — order view and driver-side order lifecycle interaction.
- `src/pages/Sandbox/` — sandbox/development screen.

The exact route table and reachability of every page still require a pass through `Routes.tsx` and its imports.

## 4. API layer

The `src/API/` area includes:

- `auth.ts` — registration, login, password recovery and WhatsApp-related registration.
- `user.ts` — user operations.
- `car.ts` — vehicle operations.
- `order.ts` — order lifecycle and voting operations.
- `location.ts`, `way.ts`, `polygon.ts` — location, route-area and polygon operations.
- `cacheVersion.ts`, `constants.ts`, `index.ts` — API support and exports.

`src/API/index.ts` is a substantial facade and contains additional HTTP operations, including trip, file, referral, configuration and route/address-suggestion logic. Therefore the file count must not be mistaken for the number of API methods.

The shared wrapper in `src/tools/api.ts` creates FormData, adds authentication token and user hash for authenticated calls, and rejects when credentials are unavailable. It also provides `addToFormData`. Its truthiness check skips falsy values; this requires review for fields where `0` or `false` is a meaningful payload.

**Pending:** enumerate every exported API method and every direct Axios/fetch call, identify endpoint and HTTP method, payload construction, response normalization, caller, error path and test.

## 5. Redux, Saga and Thunk

Observed state areas:

`areas`, `cars`, `clientOrder`, `config`, `geolocation`, `modals`, `order`, `orderControlMode`, `orders`, `ordersDetails`, `user`.

`src/state/rootSaga.ts` combines sagas for geolocation, clientOrder, user, cars, orders, ordersDetails, order, config and areas.

The source also uses Redux Thunk. This means business operations and asynchronous effects are not exclusively represented by Saga. A later pass must identify ownership and overlap for each domain, including refresh races and duplicate requests.

**Pending:** action → reducer → selector → Saga/Thunk → API/Gateway → UI mapping, including dead or orphaned actions and reducers.

## 6. UI components and forms

The component tree contains map and location controls, order cards, passenger live-order UI, modal flows, authentication/profile UI and reusable inputs.

Form-related candidates observed include `JSONForm`, `Input`, `LocationInput`, `PriceInput`, and date/time interval input components. Relevant form flows also appear in page components and modal components, not only in a dedicated forms directory.

**Pending:** build a form register with field name, type, requiredness, defaults, client validation, server validation, submit handler, API method, loading/disabled state, success/error display and tests.

## 7. Platform Interface and FSM

The 90-file `src/platform/` area contains four principal areas:

| Area | Responsibility |
|---|---|
| `interaction-contract/` | Action/event/model contracts |
| `map-channel/` | Map interaction channel and protocol |
| `platform-interface/` | Runtime, snapshots, surfaces, navigation and realtime |
| `adapters/` | Legacy backend boundary and FSM transports |

Observed adapter files include:

- `FsmTaxiCommandTransport.ts`
- `FsmCommandStatusTransport.ts`
- `FsmDriverSnapshotTransport.ts`
- `FsmOrderSnapshotTransport.ts`
- `DriverMapGateway.ts`
- `DriverCommandCompletionWaiter.ts`
- `LegacyBackendGateway.ts`
- `LegacyPassengerGateway.ts`
- `LegacyReduxSnapshotProvider.ts`
- `LegacyPassengerChannelStoreAdapter.ts`
- `LegacyRouteProvider.ts`
- `LegacyChatGateway.ts`

Observed integration behavior from source:

1. `App.tsx` creates a legacy Redux snapshot provider and optionally creates server-side FSM snapshot providers based on environment configuration.
2. Driver snapshot provider is selected for a logged-in driver when configured; otherwise the configured order provider or legacy Redux provider is used.
3. `DriverMapGateway` can use `FsmTaxiCommandTransport`; its default command-status waiter is also configuration-dependent.
4. Passenger mutations in `LegacyPassengerGateway` are represented as Platform Interface actions/events but are executed through `LegacyBackendGateway` and the legacy API.
5. Driver FSM command transport uses `POST /api/commands/taxi/order/{orderId}`; command status transport uses `GET /api/commands/{instanceId}`.
6. Order and driver snapshot transports support HTTP query and WebSocket realtime paths. Driver transport also has a recovery polling interval.

Relevant environment variable families observed include `REACT_APP_FSM_API_URL`, `REACT_APP_FSM_API_TOKEN`, `REACT_APP_FSM_WS_URL`, `REACT_APP_FSM_COMMAND_STATUS_ENABLED`, `REACT_APP_FSM_COMMAND_STATUS_POLL_MS`, `REACT_APP_FSM_DRIVER_USER_ID` and `REACT_APP_FSM_DRIVER_POLL_MS`.

**Important:** source-level support does not prove that these variables are set in any deployed environment or that the backend implements the corresponding contracts. Passenger command migration is not complete merely because Passenger UI actions pass through the interaction contract.

## 8. Configuration and runtime

Observed:

- `src/index.tsx` mounts React, Redux Provider, BrowserRouter, date localization and Helmet.
- It imports the service-worker module but calls `serviceWorker.unregister()`.
- `src/config.ts` reads a `config` query parameter or localStorage and loads `https://ibronevik.ru/taxi/cache/data_{config}.js`.
- `src/API/index.ts` resolves configuration values from site constants, Config and CRA environment variables.
- The application sends a START message to `ReactNativeWebView` when that bridge exists.
- `App.tsx` activates the chat server and repeats activation every 30 seconds.

**Pending:** full build matrix, environment variable inventory, secret exposure review, source-map and deploy configuration, cache behavior and environment parity.

## 9. External integration candidates

The following integration families are visible in the source or package architecture and need call-site/configuration verification:

| Integration | Observed purpose / next verification |
|---|---|
| iBronevik REST API | Primary legacy API; enumerate all endpoints |
| Leaflet / React Leaflet | Map rendering and interaction |
| HERE | Address suggestions/geocoding; verify key and fallback |
| Nominatim / OSM | Reverse geocoding and address lookup paths |
| OSRM / OpenRouteService | Route calculation/fallback; verify exact runtime selection and key handling |
| WebSocket | FSM realtime and chat; verify URLs, auth and reconnect behavior |
| Dropbox API | File upload/download endpoints |
| Google login | Verify OAuth configuration and callback flow |
| WhatsApp | Registration/authentication path; verify backend dependency |
| React Native WebView | Native bridge messaging |
| Sentry | Verify initialization and environment-specific DSN |

This is an integration candidate list, not confirmation that every service is active in production.

## 10. Initial risks and questions

| ID | Risk / question | Evidence needed |
|---|---|---|
| INV-01 | FSM integration may be absent in deployed builds if environment flags are missing | Inspect deployment environments and runtime network traces |
| INV-02 | Passenger commands still use legacy backend API behind an adapter | Trace all Passenger mutations and define migration boundary |
| INV-03 | API wrapper skips falsy FormData values | Review every affected method and field semantics |
| INV-04 | API facade may contain many operations beyond the named API modules | Generate exhaustive export/call inventory |
| INV-05 | Service Worker is explicitly unregistered | Confirm expected PWA/offline/cache requirements |
| INV-06 | External mapping providers and fallback order may differ by environment | Trace exact provider selection and test failure paths |
| INV-07 | Runtime site configuration is loaded dynamically from remote script | Review trust, failure, cache and environment behavior |
| INV-08 | Source files and repository documentation may describe different migration stages | Treat source at pinned commit as primary evidence |

## 11. Current coverage assessment

| Domain | Inventory | Execution trace | Test mapping | Status |
|---|---|---|---|---|
| Source tree | Complete first-pass count | N/A | N/A | Initial pass complete |
| Pages/routes | Candidate pages identified | Partial | Not mapped | In progress |
| API | Main modules identified | Not complete | Not mapped | Pending |
| Forms | Candidates identified | Not complete | Not mapped | Pending |
| Components | Directory counted | Not complete | Not mapped | Pending |
| Redux/Saga/Thunk | Main domains identified | Not complete | Not mapped | Pending |
| Platform Interface/FSM | Key adapters identified | Partial | Test files exist; mapping pending | In progress |
| Config/build | Main runtime mechanisms identified | Partial | Not mapped | Pending |
| External integrations | Candidate list identified | Not complete | Not mapped | Pending |

## 12. Next work

The next artifact should be the exhaustive API register. For every method record:

`UI/component → action/gateway → API method → HTTP method + endpoint → request fields → response shape → error handling → tests`.

No pilot-readiness conclusion should be drawn from this inventory alone.
