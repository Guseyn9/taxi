# Stage 47 — URL query double-decoding and startup Saga failure

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace query-string parsing for OAuth redirect and referral-prefill parameters, determine whether decoding is duplicated, and follow the error into Redux-Saga startup.
- Source review only. No browser URL was opened, no OAuth request was sent and no runtime reproduction was performed.
- No application source, tests, runtime configuration or CI files were changed. This stage adds documentation only.

## Executive result

A query-string value returned by `URLSearchParams.get()` is already percent-decoded. The frontend applies `decodeURIComponent()` to that value again.

The strongest path is `auth_hash`:
1. `src/state/user/sagas.ts::handleRedirectSaga` reads `auth_hash` from `URLSearchParams`.
2. It calls `decodeURIComponent(authHash)` without a try/catch.
3. `userSaga` invokes `call(handleRedirectSaga)` as one member of an attached `all([...])` effect alongside the user action watchers.
4. `rootSaga` starts all domain sagas in another attached `all([...])` effect.
5. The saga middleware is created without an `onError` recovery handler and starts `rootSaga` directly.

For a URL such as `?auth_hash=%25`, URLSearchParams returns the literal string `%`; the second decode throws `URIError: URI malformed`. Based on the attached `all` structure, that child failure propagates and cancels the user saga and sibling root sagas. This can disable the application's saga-driven workflows for that page load. The same double-decoding pattern exists in referral prefill parameters `u_email` and `u_name`, though those are processed from React effects rather than the root Saga.

This is a source-derived startup availability defect. A crafted link is sufficient to supply the malformed parameter; no user authentication is required to reach the parsing code. Runtime reproduction was not performed, so the exact visible failure behavior remains to be confirmed.

## Finding

### URL-47-01 — Malformed percent-encoded auth_hash can throw during root Saga startup and cancel domain watchers

**Severity: High (P1 availability defect).**

**Observed in source:**
- `src/state/user/sagas.ts::handleRedirectSaga`:
  - creates `new URLSearchParams(window.location.search)`;
  - reads `params.get('auth_hash')`;
  - if truthy, dispatches `GOOGLE_LOGIN_REQUEST` with `auth_hash: decodeURIComponent(authHash)`.
- The `URLSearchParams` API decodes percent-encoded query components while parsing. The additional decode is redundant and can throw on a decoded percent sign that is not followed by two hexadecimal digits.
- `userSaga` includes `call(handleRedirectSaga)` in the same `all([...])` as the user action watchers.
- `rootSaga` includes `userSaga()` and all other domain sagas in its own `all([...])`.
- `src/state/index.ts` creates saga middleware with `createSagaMiddleware()` (no visible `onError` option) and calls `sagaMiddleware.run(rootSaga)` without a restart wrapper.
- No dedicated `handleRedirectSaga` test or `auth_hash` URL parsing test was found in the repository search performed for this stage.

**Concrete malformed input:**
- URL: `https://<app-host>/?auth_hash=%25`
- First decode by URLSearchParams: `%25` → `%`
- Second decode in `decodeURIComponent('%')`: throws `URIError`.

The URL is illustrative; no request to a real app host was made.

**Impact:**
- An uncaught error in `handleRedirectSaga` rejects the child effect. Redux-Saga attached `all` effects propagate child errors and cancel sibling effects; the user watchers and other root-level domain sagas can therefore be cancelled during startup.
- Saga-driven login, registration, order, location, car and other workflows may stop functioning in that browser page until a full reload with a non-malformed URL.
- The attack requires a victim to open a crafted app URL. It does not require an authenticated session to trigger the parsing path.
- This is a denial-of-service/availability issue, not code execution or account compromise.

**Recommended action:**
1. Remove the redundant `decodeURIComponent(authHash)`; pass the value returned by `URLSearchParams` directly to the API.
2. Validate the expected auth-hash format/length before dispatch. Invalid input should be rejected locally without throwing.
3. Ensure redirect parsing is isolated from watcher startup: malformed query data must not be able to cancel the root Saga tree.
4. Add tests for normal encoded values, literal percent signs, malformed percent escapes, empty values, repeated query parameters and excessively long values.
5. Add a root-Saga regression test proving that malformed redirect parameters do not cancel unrelated domain watchers.

**Unverified:** exact runtime cancellation/visible UI behavior, backend auth_hash character constraints and whether any upstream OAuth provider can produce such a value. The malformed query can also be supplied directly by an arbitrary link.

### URL-47-02 — Referral prefill query parameters are decoded repeatedly

**Severity: Low (P2 robustness; same malformed-input class).**

**Observed in source:**
- `src/components/modals/index.tsx::ModalHost` reads `u_email` and `u_name` with `URLSearchParams.get()`, then calls `decodeURIComponent` on both values.
- `src/components/modals/LoginModal/Login.tsx::getParamFromURL` reads with `URLSearchParams.get()` and itself calls `decodeURIComponent`. The effect consuming those values then calls `decodeURIComponent` again.
- A query containing `u_email=%25` or `u_name=%25` can therefore throw during modal prefill. In the Login component path, the value is decoded an additional time before being assigned to the modal state.

**Impact and qualification:**
- Malformed referral links can break the prefill effect and may interfere with opening the registration/referral modal.
- The values are passed as React form data, not into an HTML sink in this path; no XSS is claimed.
- The exact effect on the whole React tree was not reproduced.

**Recommended action:**
- Treat URLSearchParams values as already decoded. Remove all extra `decodeURIComponent` calls.
- Validate email/name values using their actual field validators and handle invalid input without throwing.
- Add tests for percent signs, plus signs, Unicode, malformed encodings and ordinary email/name values.

## Test and execution status

- Search found no dedicated `handleRedirectSaga` or `auth_hash` parsing tests.
- Tests executed: none.
- Browser reproduction: not run.
- Backend/OAuth contract: not inspected.
- Application source changed: no.
