# Stage 30 — Public repository artifacts, emulator exposure and CI traces

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: public repository contents, driver/client emulator configuration and call paths, browser exposure of emulator controls, Playwright trace/video/screenshot retention, and files copied from `public/` into the deployable build.
- This report records the Stage 30 investigation performed in the audit conversation and preserves its findings as documentation.
- No application source, emulator configuration, workflow, deployment configuration or CI artifact was modified or deleted.
- No production URL was available for this stage. Findings are source/repository/CI configuration observations unless explicitly stated otherwise; they do not prove what a live production host currently serves.

## Executive result

The repository contains a serious separation problem between development/test tooling and the public application/repository:

1. The tracked driver-emulator configuration contains account credentials and operational flags. The browser emulator source also contains hard-coded account credentials.
2. Emulator UI surfaces are reachable from application header/page composition without a reliable production-only exclusion or authentication boundary. The emulators can perform real backend mutations, not just simulate local UI.
3. The emulator's “check” action is not guaranteed to be read-only; its initialization/check path can authenticate users and change driver/car state, availability and coordinates, and the client emulator can register users or create orders.
4. Stopping the browser emulator's local loop does not establish that backend drivers have been taken offline.
5. Playwright traces are retained on failures and uploaded as workflow artifacts. A trace attached to failed tests in run #178 was confirmed to exist; the relevant test comment explicitly warns that traces can contain session tokens.
6. The public directory contains internal reports, configuration and development files that the build copies into the static output.
7. The public repository and CI artifacts therefore need to be treated as potentially sensitive operational surfaces. Credential rotation and artifact review are required; simply hiding the emulator button is not sufficient.

## Findings

### PUB-30-01 — Tracked emulator configuration contains account credentials

**Severity: Critical (credential exposure).**

**Observed:**
- `taxi/driver-emulator/config.json` is tracked in the repository.
- The file contains login/password entries for test drivers, a manager and a client. Secret values are intentionally not reproduced in this report.
- The emulator reads configuration from the driver-emulator project; this is not merely an unused example file.
- A separate `config.example.json` exists, but the live `config.json` is also present in the repository.
- The repository ignore rules do not exclude this tracked runtime configuration.

**Impact:**
- Anyone with access to the public repository can retrieve the embedded credentials.
- If any account is still valid outside a fully isolated test environment, it may permit unauthorized access or real backend actions.
- Deleting the values in a later commit does not revoke credentials already exposed in repository history or cloned copies.

**Recommendation:**
- Treat every exposed credential as compromised. Rotate/revoke the affected accounts and invalidate sessions/tokens.
- Remove real credentials from tracked configuration. Keep only placeholders in the example file and load runtime values from an untracked local file or CI secret store.
- Add an explicit ignore rule for the runtime config, and verify the file is no longer tracked.
- Review repository history and any forks/caches for prior copies; do not rely on a cleanup commit as credential rotation.

### PUB-30-02 — Browser emulator source contains hard-coded account credentials

**Severity: Critical (credential exposure).**

**Observed:**
- `taxi/src/components/DriverEmulatorPanel/browserEmulator.ts` contains hard-coded login credentials used by the browser emulator to authenticate against the backend.
- These values are part of frontend source and therefore are not secret even if the emulator UI is hidden or the source is minified.

**Impact:**
- Credentials can be extracted from the public source repository and from a deployed JavaScript bundle if this module is included in that bundle.
- The account may be usable independently of the emulator UI.

**Recommendation:**
- Revoke/rotate the credentials.
- Remove credential literals from frontend source. Browser code must never hold privileged or reusable account passwords.
- Move any required test orchestration to an isolated server-side test harness with short-lived, least-privilege test identities.
- Confirm whether the module is included in production bundles; do not treat exclusion from the visible UI as proof that credentials are absent from the bundle.

### PUB-30-03 — Emulator controls are exposed through application page composition

**Severity: High (unauthorized test-control surface; production inclusion requires deployment verification).**

**Observed:**
- `taxi/src/components/Header/index.tsx` includes the emulator panel on passenger-facing pages without a robust authorization check.
- The client emulator is also surfaced on `/driver-order` before normal client authentication.
- The UI visibility decision is not an adequate security boundary and does not establish that the current session is a designated test operator.

**Impact:**
- A visitor may be offered test controls in ordinary application flows.
- If the emulator module and its credentials are included in the deployed bundle, hiding or removing a panel at runtime does not protect the underlying code or accounts.
- The resulting interface can trigger real backend operations (see PUB-30-04).

**Recommendation:**
- Remove emulator UI and modules from production builds at compile time using an explicit development/test build boundary.
- Require server-side authorization for every emulator operation; a client-side route or role check is insufficient.
- Add an automated production-build assertion that emulator modules, credentials and emulator-only routes are absent.
- Verify the actual deployed bundle and page behavior after the change.

### PUB-30-04 — Browser emulators perform real backend mutations

**Severity: Critical (test tooling can affect real accounts and orders).**

**Observed:**
- The driver emulator can authenticate, approve a driver and vehicle, activate a vehicle, switch driver availability/online state and send coordinates.
- The client emulator can register client accounts and create real orders.
- These are calls to application backend APIs; the emulator is not confined to mock data or an isolated in-memory simulation.

**Impact:**
- Running the emulator against a production or shared backend can mutate real account, vehicle, availability, location and order data.
- A tester can unintentionally create operational side effects merely by opening or using a diagnostic panel.
- The same risk applies to automated checks if they target a non-isolated backend.

**Recommendation:**
- Make emulator operation impossible against production by default and enforce the restriction server-side.
- Use a dedicated test backend/database and clearly separated test credentials.
- Require an explicit environment identity check before enabling mutations; fail closed if environment identity cannot be established.
- Add audit logging and cleanup procedures for test accounts, vehicles, locations and orders.
- Document which emulator actions are read-only and which mutate backend state.

### PUB-30-05 — Emulator “Check” action is not reliably read-only

**Severity: High (unexpected backend mutation from diagnostic action).**

**Observed:**
- The panel's `Проверить` action calls `emulator.check()`.
- The driver-side check/initialization path may authenticate drivers, approve driver/vehicle records, activate vehicles, switch them online and update coordinates.
- The client-side emulator can register clients and create orders as part of its setup path.
- Thus the label “Проверить” does not describe a guaranteed read-only diagnostic operation.

**Impact:**
- An operator may reasonably expect a health check but instead cause backend mutations.
- Repeated checks can create duplicate or changed test data and can affect dispatch/availability state.

**Recommendation:**
- Split diagnostics from provisioning and simulation.
- Implement a strictly read-only health check that performs only safe GET/status checks and never logs in as an account or changes backend state.
- Rename mutating operations explicitly (for example, “Initialize test drivers” or “Create test order”) and require confirmation.
- Add tests that assert no POST/PATCH/DELETE requests occur during the read-only check.

### PUB-30-06 — Stopping the browser emulator does not guarantee backend drivers are offline

**Severity: High (orphaned online test drivers).**

**Observed:**
- `BrowserDriverEmulator.stop()` stops the local browser-side loop.
- The stop path does not guarantee a corresponding backend transition that marks every emulator-controlled driver offline.

**Impact:**
- Drivers may remain online in backend dispatch after the browser emulator has stopped or the page has been closed.
- Stale coordinates and availability can mislead dispatch and pollute pilot/test data.

**Recommendation:**
- Implement explicit server-side session ownership for emulator-created online state.
- On stop, send a bounded cleanup command for every driver controlled by that emulator session and verify the resulting backend state.
- Add TTL/lease expiration on the backend so abandoned emulator sessions are taken offline even after browser crash or network loss.
- Show cleanup failures clearly; do not report a clean stop until backend state is reconciled.

### PUB-30-07 — Failure traces may contain session tokens and are retained as CI artifacts

**Severity: Critical (potential authentication-token exposure in CI artifacts).**

**Observed:**
- `playwright.config.ts` globally configures `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'`.
- Tracing is disabled only for the named `setup` and `passenger-driver-flow` projects; other tests retain traces on failure.
- A code comment associated with `passenger-driver-flow` explicitly notes that traces contain session tokens.
- In E2E run #178, trace ZIP artifacts were confirmed for failed/retried `offer-passenger-cancel` and `trip-finish` tests.
- The workflow uploads the `e2e-results/` directory as a GitHub Actions artifact with a seven-day retention period.
- Run #178 artifact: ID `13103060100`, name `playwright-e2e-41352348603-1`, size 20,536,179 bytes, expiry recorded as `2026-11-08T21:59:01Z`.
- Other retained workflow artifacts were also enumerated during the investigation. Their individual contents were not all inspected; this report does not claim every artifact contains a trace or token.
- Run #178 reported 19 passed and 2 flaky tests; `offer-passenger-cancel` and `trip-finish` failed initially and passed on retry. The cancellation assertion observed status 3 (Canceled) where status 2 (Approved) was expected before cancellation. The trip-finish flow did not observe the expected button recovery after GPS update within 120 seconds on its first attempt.

**Impact:**
- Playwright traces can capture request/response data, page state, URLs, headers and other browser activity. If authentication tokens are present in captured state, anyone authorized to download the artifact may be able to reuse them until expiry/revocation.
- Public repository visibility does not automatically mean every Actions artifact is publicly downloadable in every repository configuration, but repository collaborators and users with appropriate Actions permissions can access retained artifacts. Access settings must be checked.
- Seven-day retention limits exposure duration but does not neutralize an already captured live token.

**Recommendation:**
- Treat any token captured in a retained trace as compromised: revoke relevant sessions/tokens and rotate credentials where appropriate.
- Do not record authenticated traces by default. Prefer trace capture only in isolated test environments with synthetic accounts and non-production tokens.
- Scrub authorization headers, cookies, local storage and sensitive query parameters before artifact upload; verify scrubbing by inspecting actual trace contents.
- Restrict artifact access, minimize retention, and avoid uploading the full results directory when only sanitized reports are needed.
- Review currently retained artifacts, especially run #178, and delete sensitive artifacts where the repository's access controls permit. Deletion should follow evidence-preservation and incident-response requirements.
- Fix flaky test synchronization separately; retries must not conceal state-transition races.

### PUB-30-08 — Public directory contains internal fix reports and development/configuration files

**Severity: Medium (unnecessary information disclosure and deployment hygiene).**

**Observed:**
- The CRA build script copies files from `public/` into the build output.
- The public directory contains internal `FIX_REPORT_*.txt` files, documentation and development/configuration artifacts.
- Seven fix reports were identified:
  - `FIX_REPORT_GRUZVILL_OFFER_COMMENT_ERROR.txt`
  - `FIX_REPORT_GRUZVILL_OFFER_DRIVER_COMMENT.txt`
  - `FIX_REPORT_MINI_ORDER_TYPE_ICON.txt`
  - `FIX_REPORT_PASSENGER_TOP_CARD.txt`
  - `FIX_REPORT_PASSENGER_UI.txt`
  - `FIX_REPORT_TOP_PANEL_PLAIN_ORDER_ICON.txt`
  - `FIX_REPORT_WHITE_SCREEN_AFTER_VOTE.txt`
- Other copied candidates include `pre-build.js`, `vercel.json`, `tsconfig.json`, `blocks.md`, `json-form.md`, `readme.md`, `changelog.md`, `.editorconfig`, `.eslintrc.json` and `.vercelignore`.
- The reviewed fix reports contain internal implementation details, API field names and debugging history. No passwords were identified in those seven reports during this check.

**Impact:**
- These files can be served as static public assets if they are copied into the deployed build.
- Internal implementation history and configuration details are unnecessarily exposed.
- Publishing a Node build script or configuration file may reveal operational structure and create avoidable attack-surface information, even when the file contains no secret.

**Recommendation:**
- Move internal reports and development files out of `public/`.
- Keep `public/` limited to intentional browser-delivered assets.
- Add a build-output allowlist/denylist test for reports, dotfiles, scripts, source configuration and environment files.
- Inspect the actual deployed asset paths before declaring the files publicly reachable.

### PUB-30-09 — Public mock map data and OSM source are large and require deployment-purpose review

**Severity: Medium (performance and unnecessary public data exposure; content sensitivity not established).**

**Observed:**
- `taxi/public/mock/agadir.json` is approximately 9.13 MB.
- `taxi/public/mock/agadir.osm` is approximately 59.05 MB.
- `getArea()` in `taxi/src/API/way.ts` loads `/mock/agadir.json` as part of the route/road-graph path.
- `getAreaFromXML()` is declared, but no call site was found in the inspected source.
- `getAreasIdsBetweenPoints()` returns `[0]`, and `getArea(id)` does not use the supplied ID, indicating a single hard-wired Agadir graph path in this implementation.

**Impact:**
- The JSON graph is a large public download and can affect first-use performance and mobile data usage.
- The OSM XML may be an unused, very large public artifact; its removal should be based on a complete runtime/build reference check.
- The area selection implementation is not a general multi-area selector despite accepting an ID parameter.

**Recommendation:**
- Keep the JSON graph only if the browser routing path requires it; consider compression, regional chunking or a backend route service.
- Confirm no runtime, deployment or operational tooling consumes the OSM XML before removing it from public assets.
- Replace the hard-coded single-area behavior with explicit area metadata/selection if multi-city coverage is intended.
- Measure transfer size and cold-start route calculation on a representative mobile connection.

### PUB-30-10 — Unused public custom UI assets are present

**Severity: Low (deployment hygiene).**

**Observed:**
- `taxi/public/custom-ui-fixes.css` is approximately 9.7 KB.
- `taxi/public/custom-ui-fixes.js` is an empty stub.
- Neither file is referenced by the reviewed `public/index.html` or source call sites.

**Impact:**
- These assets are likely copied into the build despite not being used.
- They add maintenance ambiguity and unnecessary public files.

**Recommendation:**
- Remove them only after a full reference check across runtime injection, deployment scripts and external consumers.
- Add a build artifact check to prevent accidental publication of unused development assets.

### PUB-30-11 — Web app manifest retains Create React App identity

**Severity: Low (product identity and install metadata).**

**Observed:**
- `taxi/public/manifest.json` retains generic `React App` / `Create React App Sample` naming and starter metadata, inconsistent with the Taxi application identity elsewhere in the repository.

**Impact:**
- Browser install prompts, home-screen metadata and application identity may appear generic or inconsistent when the manifest is used.

**Recommendation:**
- Set the correct product name, short name, description, icons, theme/background colors and start URL.
- Verify install metadata in supported mobile browsers after deployment.

### PUB-30-12 — Leaflet package and CDN versions are inconsistent

**Severity: Low/Medium (runtime compatibility and external dependency).**

**Observed:**
- The npm package declares Leaflet 1.9.4.
- `public/index.html` loads Leaflet CSS and marker resources from CDN version 1.6.0.
- This creates a mixed-version runtime dependency between bundled JavaScript and CDN-hosted CSS/assets.

**Impact:**
- Version skew can cause visual/behavioral incompatibilities and makes the application depend on third-party CDN availability.
- Reproducibility and offline/local testing are weaker.

**Recommendation:**
- Use one pinned Leaflet version for JavaScript, CSS and marker assets.
- Prefer locally bundled assets or a controlled CDN with integrity/version pinning.
- Add a smoke test for map rendering, marker icons and map interactions.

### PUB-30-13 — Frontend FSM token configuration requires environment verification

**Severity: High if a privileged token is deployed; otherwise test-configuration risk.**

**Observed:**
- `REACT_APP_FSM_API_TOKEN` is referenced by frontend code.
- The repository's `config/env.js` injects all `REACT_APP_*` variables into the browser build.
- A value supplied as `REACT_APP_FSM_API_TOKEN` is therefore extractable by anyone who can inspect the resulting bundle.
- The audit evidence characterizes the token as acceptable only for a test environment; actual Vercel production environment values were not available for inspection.
- A token can also be exposed in WebSocket query URLs and corresponding logs depending on the configured transport.

**Impact:**
- A privileged or long-lived token in a browser bundle is public, regardless of minification or source-map settings.
- Query-string credentials can be copied into proxy, application and observability logs.

**Recommendation:**
- Inspect Vercel production and preview environment variables and rotate any exposed privileged token.
- Do not put privileged secrets in `REACT_APP_*`; proxy privileged operations through an authenticated backend or use narrowly scoped, short-lived user tokens.
- Avoid query-string credentials where a supported authorization header or secure session mechanism exists.
- Add CI scanning for secret-like values in built assets.

### PUB-30-14 — WhatsApp bot endpoint and key constants are stale or test-only and need classification

**Severity: Low/Medium (configuration hygiene; no active secret established).**

**Observed:**
- `taxi/src/constants.ts` contains `WHATSAPP_BOT_URL = 'http://localhost:7000'` and a short `WHATSAPP_BOT_KEY` literal.
- The key's only located usage was in commented-out code in `LoginModal/Register.tsx`; no active request path was established in this pass.

**Impact:**
- Stale local endpoint configuration can cause confusion and accidental misuse during future changes.
- The literal should not be treated as a production credential based on the evidence found, but it should not remain unexplained in client source.

**Recommendation:**
- Remove dead constants or move active configuration to an appropriate environment/configuration layer.
- If the key was ever valid against a real service, rotate it; otherwise label it explicitly as a non-secret placeholder.
- Add a dead-configuration scan to the release checklist.

### PUB-30-15 — Version and project identity metadata disagree

**Severity: Low (release traceability and product consistency).**

**Observed:**
- `package.json` reports version `0.1.20` and name `taxi-driver`.
- `src/version.json` reports version `0.1.22` and name `taxi-app`.
- `src/constants.ts` uses app name `taxi-web`.
- `public/index.html` uses `Taxi App`.
- `public/manifest.json` retains Create React App starter identity.
- `public/readme.md` documents Node versions below 14, while `package.json` specifies Node 24.x.

**Impact:**
- Support and release diagnostics may report inconsistent application identity/version.
- Build/developer setup documentation can direct contributors to an incompatible runtime.

**Recommendation:**
- Establish one release-version source and generate all displayed version metadata from it.
- Align package/app/manifest names and update Node/toolchain documentation.
- Add a CI consistency check.

### PUB-30-16 — Build lifecycle hooks can invoke pre-build version mutation more than once

**Severity: Low/Medium (build reproducibility and dirty working tree).**

**Observed:**
- `package.json` defines `prestart`/`prebuild` lifecycle hooks and separate `start:nix`/`build:nix` commands that invoke `node pre-build.js`.
- Depending on the command path, the same pre-build script can run through npm lifecycle handling and explicit command composition.
- The script updates tracked `src/version.json`.

**Impact:**
- Version mutation can occur more than once and can leave the working tree modified during local/CI builds.
- Build outputs may depend on execution order and environment rather than a single immutable release input.

**Recommendation:**
- Make version generation a single explicit step.
- Generate build metadata into an ignored build artifact or inject it at compile time; do not mutate tracked source during build.
- Add a CI check that the source tree remains clean after build.

### PUB-30-17 — Environment files are not explicitly excluded by the frontend .gitignore

**Severity: Medium (future secret-leak prevention).**

**Observed:**
- `taxi/.gitignore` does not explicitly exclude `.env` and `.env.production`.
- The current finding is about missing preventive ignore rules; it does not establish that a production environment file is currently tracked.

**Impact:**
- Developers may accidentally commit local or production environment files.
- A later commit can expose secrets unless repository-level secret scanning catches them.

**Recommendation:**
- Add explicit ignore entries for `.env`, `.env.*` and local overrides, while allowing a sanitized `.env.example`.
- Check tracked files and repository history for environment files.
- Enable GitHub secret scanning/push protection where available.

## Correction to an earlier interpretation

The external analytics guard does **not** block all external traffic. Its URL matching is limited to two patterns identified in the source: `gtmpx.com/ga` and a query parameter `xtId` whose value contains `_yabrowser-`. It globally monkey-patches browser APIs and DOM insertion methods, but the observed effect is selective filtering. The principal concern is compatibility, hidden side effects and fragile interception—not a general network-security boundary.

For blocked XHR calls, `open()` does not initialize the request and `send()` becomes a no-op; normal completion events are not guaranteed. For blocked `fetch` and `sendBeacon`, the wrapper simulates successful completion. This can mislead callers and leave XHR consumers waiting.

## Recommended remediation order

1. Revoke/rotate every credential exposed by emulator config or browser source; invalidate active sessions.
2. Remove emulator credentials and mutating emulator modules from production bundles; enforce backend environment/role restrictions.
3. Make “Check” strictly read-only and make emulator stop reconcile all backend drivers offline, with server-side lease expiry.
4. Inspect and sanitize retained Playwright artifacts, especially run #178; restrict access and retention and stop capturing production/session tokens.
5. Remove internal fix reports, build scripts and configuration files from `public/`; enforce a deployable-output allowlist.
6. Review the 9.13 MB road graph and 59.05 MB OSM XML for necessity, transfer cost and public exposure.
7. Align Leaflet versions and remove unused assets.
8. Verify production FSM token configuration and eliminate privileged browser tokens.
9. Align app/version metadata, make builds deterministic and add environment-file ignore/secret scanning.
10. Correct the analytics guard design or remove it after identifying the actual third-party behavior it was intended to suppress.

## Verification checklist

- [ ] Rotate/revoke all emulator credentials found in tracked files and browser source.
- [ ] Verify no credential literals or emulator modules exist in the production bundle.
- [ ] Verify emulator endpoints reject production requests server-side.
- [ ] Verify the diagnostic “Check” path performs no mutating requests.
- [ ] Verify stopping an emulator marks all controlled drivers offline; test browser crash/network loss and lease expiry.
- [ ] Inspect run #178 trace contents and all currently retained E2E artifacts for tokens/cookies/PII; revoke any captured live credentials.
- [ ] Restrict artifact access and retention; verify sanitized artifacts before upload.
- [ ] Build the app and enumerate every emitted file; reject internal reports, source configs, scripts, dotfiles and environment files.
- [ ] Verify whether `agadir.osm`, `custom-ui-fixes.*` and duplicate configuration files are actually required.
- [ ] Test Leaflet map behavior with a single pinned version.
- [ ] Inspect Vercel production/preview environment variables for `REACT_APP_FSM_API_TOKEN`.
- [ ] Verify consistent app name/version and clean source tree after build.
- [ ] Add `.env` ignore rules and secret scanning.

## Limitations

- No production URL was supplied in this stage. The deployed page, emitted production bundle, effective HTTP headers, Vercel environment variables and actual public reachability of candidate files remain unverified.
- CI artifact metadata was enumerated and the run #178 trace attachment was confirmed, but not every retained artifact was downloaded and inspected for tokens.
- The presence of credentials in repository files is established; whether each credential is still valid is not established. Rotation is recommended regardless.
- The report distinguishes source-confirmed behavior from conditional deployment impact. It does not claim that every emulator component or every listed public file is necessarily present in the current production deployment.
- No application source, emulator configuration, workflow or deployment file was modified in this stage.
