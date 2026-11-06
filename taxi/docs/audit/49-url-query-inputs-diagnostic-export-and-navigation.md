# Stage 49 — URL query inputs, diagnostic export and navigation sink reconciliation

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Application source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit documentation HEAD before this stage: `f4934fabf792a67bd1eaade6703e665e623452aa` (stage 47/48 documentation was already present on the branch; this stage continues after it).
- Audit branch: `audit/frontend-inventory`
- Scope: continue the source-only search for external URL/query data reaching browser navigation, route construction, dynamic resource loading and diagnostic output; reconcile remaining sinks rather than duplicate stages 44–48.
- No application source was changed. No tests, build, browser navigation, live OAuth flow or production configuration check was executed.

## Executive result

The remaining source search did not identify another arbitrary external-navigation sink comparable to stage 46. The navigation runtime builds paths from registered internal routes and URL-encodes dynamic path parameters. The other observed navigation actions use fixed `tel:` or fixed `https://wa.me/` schemes/hosts with phone values from order/user data; these values should be normalized, but they do not select an arbitrary scheme or hostname.

One additional privacy/security boundary was identified: the debug-log export captures the complete current URL and query string, while its sanitizer treats strings as opaque and does not redact query parameters. The Google callback's `auth_hash` is consumed as an input to the `/token` exchange but is not removed from the address bar by the inspected redirect handler. If a user exports and shares a debug log while that parameter is present, the exchange credential can be included in the exported JSON. No actual export or credential exposure was performed.

Stage 47 already records the separate double-decoding/startup-Saga failure; this stage does not duplicate it. Stage 48 already records the URL-controlled Driver emulator gate override; this stage does not duplicate that finding.

## Finding

### URL-49-01 — Debug-log export retains sensitive URL query parameters

**Severity: Medium (P2; conditional on an auth credential being present when a user exports/shares diagnostics).**

**Observed in source:**
- `src/state/user/sagas.ts::handleRedirectSaga` reads `auth_hash` from `window.location.search` and dispatches it into the Google-login flow.
- `src/API/auth.ts::googleLogin` sends the supplied `auth_hash` to `POST /token` to obtain the authenticated session tokens. This establishes that the query value is an authentication-exchange credential, not merely a display parameter. Its lifetime/replay semantics are not established by this frontend repository.
- The redirect handler does not remove `auth_hash` from the URL after reading it. The inspected URL cleanup in `src/config.ts` removes only `config` and `clearConfig`.
- `src/tools/frontendLog.ts::getEnvironmentSnapshot` copies `window.location.href` and `window.location.search` into the diagnostic environment object.
- `sanitize()` returns string values unchanged (apart from truncation). Its key-name redaction applies to object keys such as `token`, not to secrets embedded inside a URL string.
- `copyAndClearInterfaceLog` and `copyAndClearFlowDebugLog` include `getEnvironmentSnapshot()`; the Header exposes actions that download or copy these logs. The all-logs export also includes the interface/flow exports.

**Impact and qualification:**
- If the browser still has an `auth_hash` query parameter when a diagnostic export is created, the full URL/query string can be written into the exported JSON. A user who shares that file may disclose the exchange credential.
- The code path is an explicit user-initiated diagnostic export, not an automatic network upload. No evidence shows that the application sends this exported URL to a third party by itself.
- Whether an already-used `auth_hash` remains redeemable, how long it remains valid, and whether the OAuth callback URL is still present at the time support requests a log are unverified.
- Stage 47's double-decoding finding is separate: it concerns malformed query input and startup Saga availability, while URL-49-01 concerns diagnostic serialization of the raw URL.

**Recommended action:**
1. Do not include raw `href` or `search` in diagnostic exports. Store only origin/path, or parse the query and redact credential-bearing keys before serialization.
2. Maintain a denylist for credential and personal-data parameters (at minimum `auth_hash`, `token`, `access_token`, `code`, `password`, email/name fields); do not rely only on object-key redaction.
3. Remove the OAuth callback credential from browser history immediately after it has been captured for exchange, using `history.replaceState` while preserving unrelated safe parameters.
4. Add unit tests with sentinel secrets in query values and assert that interface, flow and all-log exports contain neither the raw secret nor its encoded form.
5. Confirm the backend's `auth_hash` expiry and single-use semantics in the separate backend/integration audit.

**Unverified:** credential TTL/replay semantics, actual callback URL lifecycle in production, whether users currently export logs during callback, and any real-world sharing/exposure event.

## Navigation review — no additional arbitrary external redirect confirmed

**Observed in source:**
- `NavigationRegistry.buildPath()` requires a registered route ID and substitutes route parameters using `encodeURIComponent()`.
- `NavigationRuntime.navigate()` builds a path from that registry and serializes query values with `URLSearchParams`.
- `navigatePath()` is a lower-level adapter pass-through, but the reviewed application call sites use internal route paths/route IDs. No tenant- or API-supplied external URL was found being passed to it.
- The Header's menu item type has an optional `href`, but the reviewed menu construction does not populate it from tenant/API data.
- The direct external actions found are:
  - `tel:` links using order phone fields such as `b_contact` and `from_tel`;
  - `tel:` actions using the selected driver's/user's phone;
  - `https://wa.me/` navigation using a phone value.
  The scheme and WhatsApp hostname are fixed in source; the external data supplies only the phone component. No arbitrary `javascript:` or external-host selection was identified in these paths.
- `src/API/way.ts` parses the bundled local OSM XML as `application/xml` and extracts numeric attributes plus an allowlisted set of roadway types; this is not an HTML rendering path.

**Hardening recommendations (not separate confirmed vulnerabilities):**
- Normalize phone values to the expected international-number format before building `tel:` or WhatsApp destinations; encode the WhatsApp path component and reject control characters/separators.
- Keep `navigatePath` internal-only by contract; if it ever accepts data from a tenant/API field, resolve it against the app origin and reject absolute/protocol-relative destinations.
- Keep all external support destinations behind the scheme/origin validation and opener isolation required by stage 46.

## Search coverage and disposition

| Surface searched | Result |
|---|---|
| `window.open` | Only tenant-configured support navigation; already recorded in stage 46 |
| `window.location.href` | Phone/WhatsApp actions with fixed schemes/host; no new arbitrary redirect |
| React `href` / navigation route construction | Static OAuth URL, fixed phone links, internal registered-route navigation |
| `dangerouslySetInnerHTML`, `innerHTML`, `ReactHtmlParser`, `eval` | Existing stages 44–45 sinks; no additional source match |
| `URLSearchParams` / `decodeURIComponent` | Config selector (stage 45), OAuth callback and referral prefill (stage 47), Driver emulator override (stage 48); no duplicate finding |
| `postMessage`, `iframe/srcdoc`, dynamic script insertion | No additional application-source sink identified beyond the runtime config script in stage 45 |
| XML parsing | Bundled local OSM XML parsed as XML and projected into typed route data |

This is a targeted repository code-search and source-tracing result, not a proof that every browser API, dependency behavior or deployed runtime has been exhaustively tested.

## Test and execution status

- Tests executed: none.
- Browser tests: none.
- Diagnostic export with a sentinel credential: not run.
- Production/deployment checks: none.
- Application source changed: no.
