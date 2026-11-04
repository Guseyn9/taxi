# Stage 26 — Frontend security, authentication, authorization and secrets

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: credential storage, authentication lifecycle, browser-exposed configuration/secrets, role-based route protection, command/snapshot credentials, browser logging and HTML injection sinks.
- Findings are source-level. Server-side authorization, production deployment variables, live credentials and backend policy were not inspected.
- No application source changed.

## Executive result

The frontend does not provide a security boundary against a malicious browser client. In the reviewed source:
- user API tokens are stored in browser `localStorage`;
- the build injects every `REACT_APP_*` environment variable into the browser bundle;
- FSM API Bearer credentials are explicitly read from `REACT_APP_FSM_API_TOKEN`;
- the Google authentication flow logs its complete `auth` input object;
- application routes are registered without route-level authentication/role guards;
- the FSM WebSocket adapter can put the API token in the WebSocket URL query string;
- JSON-driven checkbox labels are rendered through `dangerouslySetInnerHTML`.

Some of these risks were already noted in earlier audit stages (notably browser-visible environment variables and public routing keys). This stage consolidates them into a security-oriented threat model and records the relevant call paths.

## 1. Authentication token storage

### AUTH-26-01 — API tokens are persisted in localStorage

<badge>High</badge>

**Observed:**
- Login and Google login store `result.tokens` under `state.user.tokens`.
- Registration also persists the token pair.
- Startup reads this key, parses it and restores the tokens into Redux before calling `getAuthorizedUser`.
- The generic `apiMethod` wrapper reads tokens from Redux and appends `token` and `u_hash` to request FormData.
- Logout removes the localStorage entries.

**Impact:** any JavaScript executing in the application origin can read the stored token pair. A successful XSS, compromised third-party script, malicious remote tenant script or browser extension with page access can exfiltrate credentials and replay API requests. localStorage does not provide HttpOnly protection.

**Recommendation:**
1. Prefer a same-site backend session using Secure, HttpOnly, SameSite cookies and a BFF/API proxy, where feasible.
2. If the legacy API contract forces browser-held tokens, minimize lifetime and privilege, rotate/revoke tokens server-side, avoid persistent storage where possible, and add CSP plus strict script/dependency controls.
3. Treat any XSS or third-party script compromise as potential account-token compromise.
4. Do not log tokens or auth responses; provide a documented credential revocation/rotation process.

**Unverified:** actual token lifetime, refresh/rotation, server-side revocation and whether tokens are bound to device/session.

## 2. Build-time configuration and secrets

### AUTH-26-02 — All REACT_APP_* variables are injected into the client bundle

<badge>Critical if privileged secrets are configured</badge>

**Observed:** `src/config/env.js` selects every environment variable matching `REACT_APP_*` and serializes it into Webpack's `process.env` DefinePlugin object. This is public browser code, not a server-side secret store.

The FSM transports explicitly read:
- `REACT_APP_FSM_API_TOKEN` for HTTP Bearer authentication;
- the same token for order/driver snapshot requests;
- optionally the same token for a WebSocket query parameter.

Repository documentation already says the FSM API token enters the browser bundle and is suitable only for a test environment.

**Impact:** a privileged/shared FSM token configured in a production build is extractable by every user who can download the JavaScript bundle. Minification or obfuscation does not protect it.

**Recommendation:**
- Never put privileged, shared, administrative or cross-user credentials in `REACT_APP_*`.
- Move privileged FSM access behind a BFF that authenticates the current user and enforces role, order ownership and allowed intents.
- If a browser token is unavoidable, issue a short-lived, user-scoped, narrowly scoped token from the backend and rotate it; do not reuse a shared service token.
- Audit deployed bundles and rotate any previously exposed privileged token.

**Unverified:** which values are set in Vercel/production, whether the current FSM token is test-only, and the effective privileges/scopes of the token.

### AUTH-26-03 — WebSocket token may be placed in URL query string

<badge>High if enabled with a sensitive token</badge>

**Observed:** `FsmOrderSnapshotTransport.realtimeUrl()` appends `apiToken` under the configured `webSocketTokenQueryParameter` when both are present. The driver snapshot transport uses the same pattern.

**Impact:** URL query credentials can be retained in proxy/server access logs, monitoring, diagnostics and other URL-observing infrastructure. They are also more likely to be copied into operational traces than an Authorization header.

**Recommendation:** prefer a short-lived, single-purpose WebSocket ticket obtained over authenticated HTTPS, then pass the ticket only for the socket handshake; ensure query values are redacted from logs. If query authentication is unavoidable, use very short expiry, narrow scope and immediate revocation.

**Unverified:** whether this option is enabled in the deployed environment and whether the token is logged by the WebSocket infrastructure.

## 3. Authentication logging

### AUTH-26-04 — Google login logs the full auth input object

<badge>High</badge>

**Observed:** `src/API/auth.ts` calls `console.log(auth)` at the start of `_googleLogin`. The object includes `auth_hash` and, in the registration branch, profile data such as name, phone, email, role and user details. The hash is subsequently exchanged for API tokens.

**Impact:** browser console logs can expose an authentication exchange credential and personal data to anyone with access to the browser/devtools, remote debugging, log capture or support diagnostics. If the auth hash is reusable or valid for a meaningful period, it may enable account takeover.

**Recommendation:** remove the log entirely. Log only a non-sensitive event name and a generated correlation ID. Never log auth hashes, tokens, passwords, registration payloads or complete profile objects. Rotate/revoke outstanding auth hashes if the backend supports it.

**Related:** `LOGIN_FAIL` logs its payload in the user reducer; audit all auth failure payloads to ensure they cannot contain credentials or personal data.

## 4. Role-based route access

### AUTH-26-05 — Application routes have no explicit authentication/role guards

<badge>High pending backend enforcement</badge>

**Observed:** `src/Routes.tsx` registers Passenger, Driver, Driver Orders, Driver Test and Sandbox routes as direct route elements. The wrapper computes a default route from the current user's role, but this is a redirect/default-navigation choice, not a route authorization guard. The explicit paths can be navigated to directly; the route table itself does not reject an unauthenticated user or a user with the wrong role.

**Impact:** a client can load UI intended for another role, or unauthenticated users can reach screens before auth restoration. UI visibility is not authorization. If backend endpoints do not independently enforce role, ownership and lifecycle preconditions, direct API calls can bypass the UI.

**Recommendation:**
1. Add explicit route guards for authenticated state and allowed role, including a loading state while auth restoration is pending.
2. Hide/deny Driver, Passenger and Sandbox routes according to role; treat this only as defense-in-depth and UX.
3. Enforce every permission at the backend: role, resource ownership, order assignment, allowed state transition, driver eligibility, and command intent.
4. Add direct-navigation tests for unauthenticated, wrong-role and account-switch cases.
5. Test API endpoints directly with wrong-role and cross-user identifiers.

**Unverified:** whether all legacy and FSM backend endpoints already enforce these checks. No backend source or live authorization test was available in this stage. This finding must not be interpreted as proof of a server-side authorization bypass.

## 5. HTML injection surface

### AUTH-26-06 — JSON form checkbox label uses dangerouslySetInnerHTML

<badge>High if label/translation input is untrusted</badge>

**Observed:** `src/components/JSONForm/JSONFormElement.tsx` renders the translated/calculated checkbox label using `dangerouslySetInnerHTML`. The value is derived from `formElement.label`, form values and variables, then passed through `getTranslation`. The reviewed `getTranslation` helper performs translation lookup/fallback and does not sanitize HTML.

**Impact:** if a tenant, remote form configuration, database field, imported content or other untrusted party can influence that label, crafted markup may execute script in the application origin or inject active HTML. The sink is confirmed; attacker control of its input is not confirmed from this call path alone.

**Recommendation:**
- Render labels as React text by default.
- If rich HTML is a product requirement, sanitize with a maintained allowlist sanitizer immediately before the sink; disallow scripts, event handlers, dangerous URL schemes, SVG/MathML active content and embedded objects.
- Validate and constrain remote form schemas before rendering.
- Add XSS regression tests using script, event-handler and javascript: payloads in label and translation values.

**Unverified:** the complete provenance and trust boundary of every form label/translation source. Treat this as a conditional exploitability finding until config ownership is confirmed.

## 6. Public third-party routing credentials

### AUTH-26-07 — OpenRouteService key is hard-coded in browser source

**Severity: Medium (abuse/quota/cost), High if the key has broader privileges**

**Observed:** `src/API/index.ts` defines a literal `orsToken` and sends it from browser code in the Authorization header for routing requests. The value is recoverable from the public source/bundle.

**Impact:** third parties can reuse the key, consume its quota, cause service disruption or incur charges. This key must be treated as public, not as a secret.

**Recommendation:** rotate the key if it has not already been rotated; restrict it to the required API, allowed origins/IPs where supported and conservative quotas; monitor usage; proxy requests through a backend if provider policy or quota controls require secret credentials. Do not grant this key unrelated account permissions.

**Related earlier finding:** EXT-01 in the runtime/build integration audit.

## 7. Additional observations

- The language cookie helper writes a non-authentication preference cookie without Secure, HttpOnly or SameSite attributes. This is not itself a session-token leak; if the cookie is ever repurposed for security-sensitive state, redesign it.
- `API.logout` sends a request without FormData token fields in the inspected implementation, while local tokens are removed before the call. Backend logout semantics and server-side session invalidation require confirmation.
- `getAuthorizedUser` is used to hydrate the current profile, but frontend role/profile hydration is not proof of authorization for individual operations.
- The app performs route rendering while user initialization is asynchronous; this matches the earlier auth-restoration finding and increases the importance of a clear loading/guard state.
- The current API wrappers generally rely on the legacy API's token fields. Server-side checks must not trust client-supplied `u_id`, `u_role`, `orderId` or form fields as proof of identity/ownership.

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| AUTH-26-01 | High | API tokens persist in localStorage and are exposed to same-origin JavaScript |
| AUTH-26-02 | Critical if privileged secret configured | All REACT_APP_* values are bundled; FSM Bearer token is browser-visible |
| AUTH-26-03 | High if sensitive token used | FSM WebSocket token can be passed in URL query string |
| AUTH-26-04 | High | Google auth input including auth_hash and profile data is logged |
| AUTH-26-05 | High pending backend verification | Route table has no explicit auth/role guards; backend enforcement unverified |
| AUTH-26-06 | High if label source is untrusted | JSON form checkbox label rendered through unsanitized HTML sink |
| AUTH-26-07 | Medium | Hard-coded public ORS key can be reused and quota-abused |

## Recommended remediation order

1. Remove `console.log(auth)` and audit all auth/token logging.
2. Verify and rotate any privileged token ever included in a production `REACT_APP_*` build; move shared FSM credentials behind a BFF.
3. Verify backend role, ownership and lifecycle authorization with direct negative API tests.
4. Add route guards and an auth-restoration loading barrier.
5. Replace localStorage bearer-token persistence with an HttpOnly session/BFF where possible; otherwise constrain token lifetime and privilege.
6. Remove or sanitize the JSON-form HTML sink and test untrusted label values.
7. Replace WebSocket query bearer tokens with short-lived scoped tickets; redact query credentials from logs.
8. Restrict/rotate the ORS key and monitor provider quota.

## Files reviewed

- `src/config/env.js`
- `src/API/auth.ts`
- `src/API/user.ts`
- `src/API/index.ts`
- `src/tools/api.ts`
- `src/state/user/sagas.ts`
- `src/state/user/reducer.ts`
- `src/utils/cookies.ts`
- `src/Routes.tsx`
- `src/App.tsx`
- `src/platform/adapters/FsmTaxiCommandTransport.ts`
- `src/platform/adapters/FsmCommandStatusTransport.ts`
- `src/platform/adapters/FsmOrderSnapshotTransport.ts`
- `src/platform/adapters/FsmDriverSnapshotTransport.ts`
- `src/platform/adapters/LegacyBackendGateway.ts`
- `src/components/JSONForm/JSONFormElement.tsx`
- `src/components/JSONForm/utils.ts`

## Limitations

- No backend source, API gateway policy, IAM configuration or production deployment environment was inspected.
- No live wrong-role/cross-user API requests were sent.
- No deployed JavaScript bundle was downloaded to inventory actual injected values.
- No production browser console, CSP, HTTP response headers or WebSocket/proxy logs were inspected.
- No XSS payload was executed; exploitability depends on control of the JSON form label/translation input.
- No token expiry, refresh, rotation or revocation contract was verified.
- This is a source-level frontend security review, not a penetration test or certification.
