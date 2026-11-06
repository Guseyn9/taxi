# Stage 48 — URL-controlled override of the strict driver emulator-only gate

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace the `driverEmulator` / `extEmulator` URL switches into driver order polling, selectors and decision context; distinguish frontend gating from backend authorization.
- Source review only. No driver session was opened, no API request was sent and no production deployment was inspected.
- No application source, tests, runtime configuration or CI files were changed. This stage adds documentation only.

## Executive result

The application has a strict frontend rule that forces all driver order lists empty and skips active/ready/history backend order requests unless a browser emulator mode or external emulator mode is enabled.

The external mode can be enabled by either:
- `?driverEmulator=1`
- `?extEmulator=1`

The query value is accepted by `isExternalEmulatorEnabled()`, written to persistent localStorage, and then used by driver order sagas and selectors to disable the strict empty-order gate. No user-role allowlist, tenant allowlist, build-time production guard or server-issued authorization for this override is visible in the frontend path.

The source comment explicitly documents this as a test workflow: a headless external emulator creates test orders while a tester uses the real Driver UI. Thus the feature is intentional, not an accidental parameter. The concern is that a public URL parameter can activate a test override for any authenticated Driver session and persist it beyond the initial visit.

This does **not** bypass backend authentication or prove that a driver can obtain another driver's orders. It changes whether the frontend calls the backend and displays the orders already authorized for that driver. Production reachability and backend tenant restrictions remain unverified. The finding supplements, rather than duplicates, stage 30's broader emulator exposure review.

## Finding

### EMU-48-01 — Public query parameter persistently disables the strict emulator-only empty-order gate for Driver sessions

**Severity: High (P1 conditional on production availability of this test-only path); otherwise Medium (P2 test-environment isolation).**

**Observed in source:**
- `src/tools/emulatorMode.ts::isExternalEmulatorEnabled` reads `driverEmulator`, falling back to `extEmulator`, from `URLSearchParams(window.location.search)`.
- Any present value is normalized by `normalizeFlag`; the result is written to localStorage under `gruzvill_external_emulator` and returned.
- When no query parameter is present, the function reads the persistent localStorage flag.
- The adjacent source comment says this is the external/headless emulator mode and that it opens the emulator-only gate so real backend orders are visible in the real Driver UI.
- `src/state/orders/sagas.ts::isDriverEmulatorOnlyUiForcedEmpty` returns true for a Driver only when neither browser emulator mode nor external emulator mode is active.
- `getActiveOrdersSaga`, `getReadyOrdersSaga` and `getHistoryOrdersSaga` use this gate. When the gate is active they skip the corresponding backend request and/or force an empty list; when the URL override enables external mode, those code paths proceed to the backend API.
- `src/state/orders/selectors.ts::filterOrdersForStrictDriverEmulatorMode` also stops forcing the list empty when external mode is enabled.
- `src/tools/orderDecisionContext.ts` passes `externalEmulatorEnabled` into the order decision context.
- Repository search found no caller of `setExternalEmulatorEnabled` outside its definition; the query parameter is the visible activation mechanism in the inspected source.

**Impact and qualification:**
- A link to the app with `?driverEmulator=1` can change the recipient's Driver UI from emulator-only/empty-order behavior to backend-backed active, ready and history order polling. The value persists in localStorage after the URL is removed or the user navigates elsewhere.
- If this code is present in a production build and the strict gate is intended to prevent test drivers from interacting with real dispatch, the URL switch defeats that client-side safety control.
- The source comment confirms a deliberate test use case. It does not establish that the feature is meant to be available to every production driver.
- The frontend flag is not an authorization boundary. The backend must still authenticate the driver and filter orders/actions by identity, tenant, role and assignment. Those backend controls are outside this repository and remain unverified.
- No evidence establishes that the parameter can expose orders belonging to another driver or perform unauthorized backend mutations by itself.

**Recommended action:**
1. Do not use a URL/localStorage flag as the authority for enabling a test-only live-order mode in production.
2. Compile the external emulator path out of production builds, or require a server-issued, short-lived, role/tenant-scoped test capability that the backend validates.
3. Restrict the override to explicit test tenants and test driver accounts; fail closed if the tenant or authenticated user is not allowlisted.
4. Clear the persisted flag on logout, account switch and environment/tenant change. Avoid inheriting it into a later normal driver session.
5. Add tests proving production mode cannot enable the override through query parameters or localStorage, and that test mode remains scoped to the intended account and tenant.
6. Add backend negative tests for cross-driver order reads and mutations; do not infer backend protection from the frontend selector.

## Relationship to earlier stages

- **Stage 30 / PUB-30-03–06:** already records emulator UI exposure, browser emulator credentials, real backend mutation paths and production exclusion requirements. EMU-48-01 adds the specific URL/localStorage path that bypasses the strict empty-order behavior even without opening the emulator panel.
- **Stage 41–42:** GPS and backend location/dispatch dependencies remain separate; this stage does not assert anything about backend dispatch authorization or freshness.
- **Stage 47:** the query parser uses URLSearchParams without the redundant decode bug; the issue here is the semantics and persistence of the accepted feature flag, not malformed URL decoding.

## Test and execution status

- Dedicated tests for URL override allowlisting or production exclusion found: none in the source search performed for this stage.
- Existing ready-order polling tests set the localStorage flag to enable backend-backed test fixtures; they do not prove production gating.
- Tests executed: none.
- Production bundle/deployment inspection: not run.
- Backend authorization checks: not run.
- Application source changed: no.
