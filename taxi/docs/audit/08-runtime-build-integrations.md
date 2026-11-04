# 08. Runtime configuration, build and external integrations

## 1. Evidence baseline

**Repository:** `Guseyn9/taxi`  
**Branch:** `main`  
**Commit:** `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`

Reviewed:
- `src/App.tsx`, `src/config.ts`, `src/API/index.ts`, `src/API/cacheVersion.ts`
- `config/env.js`, `config/webpack.config.js`, `config/paths.js`
- `package.json`, `vercel.json`, `pre-build.js`
- `public/index.html`, `public/external-analytics-guard.js`
- `src/platform/adapters/*Transport.ts`, `LegacyRouteProvider.ts`
- `src/pages/Passenger/fsmFeature.ts`, `src/index.tsx`, `src/siteConstants.ts`

Source review only. No Vercel project settings, deployment environment values, production bundle, network traces or live third-party quotas were available. No build or tests were run. Findings apply to this pinned `main`, not yet confirmed against the pilot integration branch.

## 2. Build and environment model

The app uses a customized Create React App/Webpack build, not Vite. The build loads dotenv files in this precedence order:
1. `.env.<NODE_ENV>.local`
2. `.env.<NODE_ENV>`
3. `.env.local` (except test)
4. `.env`

Webpack's `config/env.js` serializes **every** environment variable matching `REACT_APP_*` into the browser bundle via DefinePlugin. These values are public to anyone who can download the JavaScript. This applies even if the value was configured as an encrypted Vercel environment variable.

The repository's `.gitignore` excludes local env files such as `.env.local` and `.env.production.local`. No `.env.example`, `.env.production` or deployment workflow was found at the inspected paths. Absence of a tracked env file does not establish which values are set in Vercel.

## 3. Findings

### BUILD-01 — FSM bearer token is compiled into the browser bundle

**Observed:** `FsmTaxiCommandTransport`, `FsmCommandStatusTransport`, `FsmDriverSnapshotTransport` and `FsmOrderSnapshotTransport` read `REACT_APP_FSM_API_TOKEN`. Webpack exports all `REACT_APP_*` values into browser JavaScript. The transports then send this token as `Authorization: Bearer ...` to FSM HTTP endpoints; the driver/order realtime transports may also put it into a WebSocket query parameter when `REACT_APP_FSM_WS_TOKEN_QUERY_PARAM` is configured.

**Impact:** the token is not a server-side secret. A user can inspect the downloaded bundle and browser network traffic. If it is a shared credential with privileges beyond the current user, it can be copied and reused outside the app. Query-string credentials can additionally appear in proxy/server logs.

**Priority:** critical if the configured token grants privileged or cross-user access; high even if currently restricted.

**Action:**
- Do not place privileged/shared credentials in any `REACT_APP_*` variable.
- Prefer a same-origin backend/BFF that authenticates the user and keeps service credentials server-side.
- If browser-to-FSM access is required, issue short-lived, user-scoped credentials and enforce authorization per order/driver on every endpoint.
- Avoid WebSocket query-string tokens where a secure cookie or supported authorization handshake is available.
- Rotate any shared token that has already been deployed to a public bundle if its scope is not strictly user-bound.

### BUILD-02 — Production Vercel build explicitly disables JavaScript minification

**Observed:** `vercel.json` sets `WEBPACK_SKIP_MINIFY=true` in the production build command. `config/webpack.config.js` maps that to `optimization.minimize=false`. The same command sets `GENERATE_SOURCEMAP=false`.

**Impact:** source maps are disabled, but the generated JavaScript remains substantially more readable than a normal minified production bundle. This is not a substitute for protecting secrets (BUILD-01 is independently exploitable) and increases code/endpoint/config discoverability.

**Priority:** medium security-hardening and release-performance issue.

**Action:** remove `WEBPACK_SKIP_MINIFY=true` after resolving the build-resource reason; measure Vercel memory/time. Keep source maps disabled for public production unless private source-map upload is deliberately configured.

### BUILD-03 — Vercel CORS headers are attached to the static frontend, not the backend API

**Observed:** root `vercel.json` adds `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Origin: https://chat.itest24.com/` and allowed methods to all static frontend paths.

**Impact/qualification:** these headers govern responses served by this Vercel frontend. They do not configure CORS on `ibronevik.ru` or the FSM API, which are separate origins. Also, the configured origin value includes a trailing slash; browser Origin values do not include a path or trailing slash, so this is not an exact origin match for `https://chat.itest24.com`. If the intent is to allow that origin to read frontend assets cross-origin, the value is malformed. If no cross-origin asset access is required, the global CORS headers are unnecessary.

**Priority:** medium configuration correctness; no conclusion about backend CORS can be drawn from this file.

**Action:** remove CORS headers from static app responses unless required. Configure CORS at the actual API origin, with explicit allowed origins and headers, credentials and OPTIONS behavior.

### BUILD-04 — Build metadata is mutated on every build/start

**Observed:** `pre-build.js` rewrites `src/version.json` with a fresh `buildTimestamp` on every invocation. It runs through `prebuild`, `prestart` and explicit build/start scripts. Vercel invokes `npm run build`, which also triggers npm's prebuild lifecycle.

**Impact:** build metadata is non-reproducible and a local start/build can dirty the working tree. The timestamp reflects build execution, not the source commit or deployment time. It uses `Date.toString()`, which includes environment-dependent timezone/format.

**Priority:** low/medium operational reproducibility.

**Action:** inject a deterministic commit SHA and ISO timestamp at build time without mutating tracked source; keep version metadata generated in build output.

### EXT-01 — OpenRouteService token is hard-coded in frontend source

**Observed:** `src/API/index.ts` defines `orsToken` as a literal and sends it in the Authorization header to the public OpenRouteService Directions endpoint. The route request originates in the browser.

**Impact:** the token is public by design in a browser app and can be extracted and reused, consuming the account quota or causing service suspension. It must not be treated as a secret. The source review cannot establish whether this token is still active, its owner, its quota or restrictions.

**Priority:** high.

**Action:** check token owner/status and usage. Rotate/revoke if it is an uncontrolled shared credential. Prefer a backend proxy with rate limits, or a dedicated restricted key with strict provider-side origin/quota restrictions if supported. Do not simply move the literal into `REACT_APP_ORS_TOKEN`; that remains public.

### EXT-02 — HERE key is also a browser-visible credential when configured

**Observed:** `HERE_API_KEY` is resolved first from runtime `SITE_CONSTANTS`, then `Config`, then `REACT_APP_HERE_API_KEY`. It is sent directly from the browser to HERE reverse-geocoding. The runtime configuration script is downloaded from `ibronevik.ru/taxi/cache/data_{config}.js`.

**Impact:** whichever source supplies the key, the browser must be able to read it, so it is extractable. HERE 401 disables further HERE reverse-geocode attempts in the current page and falls back to Nominatim. Actual key presence and provider restrictions were not verified.

**Priority:** medium/high depending on the configured account and key restrictions.

**Action:** restrict the key by allowed origins/services and quota; monitor usage. If the provider supports server-side use, proxy it through a backend. Do not regard runtime JS configuration as secret storage.

### EXT-03 — Geocoding depends on public Nominatim without a backend proxy

**Observed:** address suggestions and reverse geocoding call `nominatim.openstreetmap.org` directly from the browser. Suggestions are throttled in-memory at 650 ms; reverse geocode is serialized at 1250 ms and cached in memory. HERE is attempted first for reverse geocoding; Nominatim is fallback. The standalone `geocode` method calls Nominatim directly and does not use the suggestions queue.

**Impact:** user traffic shares public service infrastructure; browser clients can be rate-limited, blocked or affected by CORS/network conditions. Client-side throttling is per tab/session and cannot enforce aggregate application limits. Address search reliability depends on external service availability and usage policy.

**Priority:** high operational dependency for pickup/dropoff creation.

**Action:** confirm Nominatim usage policy and production traffic suitability; for a pilot, use a controlled geocoding provider or self-host/proxy with server-side rate limits, caching and observability. Keep a user-visible manual address fallback.

### EXT-04 — Routing relies on multiple public providers with no demonstrated SLA

**Observed:** route resolution order is legacy API/ORS, then local road graph, then public OSRM (`router.project-osrm.org`). Separate map/emulator utilities also call OSRM directly. Route geometry cache is stored in localStorage (ORS route cache, capped at 80 entries). Several coordinate guards use truthiness, so valid zero latitude/longitude can be rejected in local fallback/OSRM code.

**Impact:** availability and rate limits of public OSRM and OpenRouteService affect route generation. Direct browser calls bypass centralized rate control. Duplicate OSRM call sites make provider policy and telemetry harder to manage. The zero-coordinate issue is a code defect for locations on the equator/prime meridian, though unlikely for the Agadir operating area.

**Priority:** medium/high for service reliability; coordinate edge case low for Morocco pilot.

**Action:** consolidate all routing through one provider adapter; add request timeout, retry/backoff, caching and metrics. Define a production provider with acceptable terms/quotas; retain local graph as an intentional fallback, not an undocumented best-effort dependency.

### EXT-05 — External Leaflet CSS version differs from the installed Leaflet package

**Observed:** `package.json` uses Leaflet 1.9.4 and React Leaflet 5.0.0, while `public/index.html` preloads Leaflet CSS 1.6.0 from unpkg. The map component also references marker artwork from unpkg Leaflet 1.6.0.

**Impact:** mixed versions can produce subtle CSS/icon differences and an additional runtime dependency on unpkg. The CSS uses Subresource Integrity; the marker image URL does not have an equivalent integrity check.

**Priority:** medium.

**Action:** use the installed Leaflet package's CSS and marker assets, or pin the external CSS/assets to the exact package version with integrity where possible. Prefer bundling assets for predictable offline/slow-network behavior.

### EXT-06 — Analytics guard globally monkey-patches browser network and DOM APIs

**Observed:** `public/index.html` loads `external-analytics-guard.js` before the React app. The script wraps `fetch`, `sendBeacon`, `XMLHttpRequest.open/send`, `Element.setAttribute`, `Node.appendChild/insertBefore`, and observes DOM mutations to block two URL patterns.

**Impact:** this changes browser-wide behavior for the entire app, not only a specific analytics integration. Current patterns are narrow, but future changes to those patterns or unrelated code that matches them could silently suppress requests/scripts. A blocked fetch returns synthetic HTTP 204, which can make a blocked integration appear successful.

**Priority:** medium maintainability/diagnostics risk.

**Action:** prefer removing the unwanted analytics at its injection/source point or use a narrowly scoped network policy. Add automated tests for the exact blocked patterns and verify normal API/geocoding/map requests remain unaffected.

### EXT-07 — Runtime tenant configuration is loaded as executable remote JavaScript

**Observed:** `src/config.ts` loads `https://ibronevik.ru/taxi/cache/data_{config}.js` as a script. The tenant/config name is stored in localStorage and can be changed by the `?config=` query parameter. The script executes in the app's origin and populates `window.data` consumed by `siteConstants.ts`.

**Impact:** this is an executable-code trust boundary, not just JSON configuration. A compromise or unintended modification of the config host/content can execute code in the frontend origin. The query parameter also allows the browser to switch tenant config before it is removed from the address bar.

**Priority:** high supply-chain/runtime trust risk.

**Action:** migrate configuration to validated JSON fetched as data, enforce a strict schema and tenant allowlist, and avoid executing remotely supplied JavaScript. If migration is not immediately possible, restrict config publishing permissions, audit changes, serve with strong cache/version controls, and validate config names against an allowlist.

### EXT-08 — Sentry is a dependency but no runtime initialization was found

**Observed:** `@sentry/react` exists in package dependencies, but repository code search did not find `Sentry.init` or a runtime import.

**Impact:** do not assume frontend error reporting is active because the package is installed. Runtime monitoring coverage may be absent or configured outside this repository.

**Priority:** medium operational observability gap; verify before asserting it is unused in the deployed build.

**Action:** either initialize Sentry with a deliberate privacy/scrubbing policy and environment/release tags, or remove the unused dependency. Confirm whether an external monitoring agent is injected at deployment.

### EXT-09 — Service worker is explicitly unregistered

**Observed:** `src/index.tsx` calls `serviceWorker.unregister()`.

**Impact:** no offline caching/update strategy is active through this service worker entry point. This is not itself a defect for a taxi SPA, but the app should not be assumed to support offline operation or background sync.

**Priority:** informational.

**Action:** document online-only behavior and ensure the UI handles loss of network explicitly. If offline support is required, design and test it rather than merely registering the default worker.

## 4. Deployment facts not established from repository source

The following require access to Vercel project settings or a deployment artifact:
- actual production/preview values of all `REACT_APP_*` variables;
- whether `REACT_APP_FSM_API_TOKEN` is set, its privileges and whether it has been rotated;
- whether `REACT_APP_FSM_API_URL`, driver ID, order ID, WebSocket URL and Command Status flags are set together;
- whether the OpenRouteService token and HERE key are active/restricted;
- actual Vercel deployment root directory, Node version and install command;
- whether the duplicated `vercel.json` copies under `src/`, `public/` or `scripts/` are ever used (the root config is the expected Vercel project config when the project root is `taxi/`);
- whether production uses this exact commit or a separate branch/build artifact.

## 5. Pilot release blockers / gates

Before pilot publication:
1. Confirm and eliminate privileged shared credentials from all browser `REACT_APP_*` variables. Treat the FSM token as exposed if it was ever deployed.
2. Verify the OpenRouteService token owner, quota, restrictions and rotation status.
3. Verify HERE key restrictions and actual runtime config source.
4. Confirm that production uses the intended root `vercel.json`, build command, Node version and exact source commit.
5. Replace or constrain executable remote tenant configuration.
6. Confirm geocoding/routing provider terms, rate limits, caching and outage fallback.
7. Resolve or explicitly accept the Leaflet version mismatch and unpkg dependency.
8. Test the app with blocked HERE/Nominatim/ORS/OSRM and weak/intermittent network.
9. Verify frontend error reporting is actually active; otherwise add a pilot monitoring plan.
10. Treat CORS headers on Vercel static assets separately from CORS configuration on iBronevik/FSM APIs.

## 6. Next stage

Proceed to cross-check the accumulated audit against the actual pilot integration branch/commit and then perform targeted verification of the highest-risk items against the deployed Vercel project and browser bundle. Do not apply source fixes to `main` or create a PR as part of this audit.
