# Stage 47 — Double-decoded URL parameters and startup saga failure

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace URL query parsing for Google authentication redirect and referral-prefill parameters; determine whether a malformed URL value can escape startup handling.
- Source review only. No malformed URL was loaded in a browser, no auth endpoint was called, and no tests were run.
- No application source, tests, runtime configuration or CI files were changed. This stage adds documentation only.

## Executive result

The frontend calls `URLSearchParams.get()` and then calls `decodeURIComponent()` on the returned value in three places. `URLSearchParams` already percent-decodes query parameter values. The second decoding is redundant and can throw `URIError` for values that become a bare or malformed percent sequence after the first decoding.

The most consequential path is `auth_hash`:
- `src/state/user/sagas.ts::handleRedirectSaga` reads `auth_hash` with `URLSearchParams`, then calls `decodeURIComponent(authHash)` without a try/catch.
- `userSaga` starts that generator using `call(handleRedirectSaga)` inside its `all([...])` effect.
- `rootSaga` starts `userSaga()` alongside all other domain sagas in another `all([...])` effect.
- Redux-Saga's fail-fast `all` semantics mean an uncaught child error propagates and cancels sibling effects. A crafted URL such as `?auth_hash=%25` is parsed by URLSearchParams to `%`; the second decode throws. This can terminate the root saga tree and stop the application's saga-driven workflows for that page session.

This is a source-supported client-side availability defect. It has not been dynamically reproduced, so severity is assessed as **P1 / High pending regression confirmation**, not as a verified production incident.

The `u_email`/`u_name` referral-prefill paths repeat the same double decode in both `ModalHost` and `LoginForm`. Malformed values can throw from React effects and prevent referral-prefill handling; the reviewed code does not place these values into an HTML sink or use them as navigation destinations.

## Findings

### URL-47-01 — Malformed auth_hash can throw during root-saga startup

**Severity: P1 (High; client-side application availability).**

**Observed in source:**
- `src/state/user/sagas.ts::handleRedirectSaga`:
  1. constructs `new URLSearchParams(window.location.search)`;
  2. reads `params.get('auth_hash')`;
  3. if present, calls `decodeURIComponent(authHash)`;
  4. dispatches `GOOGLE_LOGIN_REQUEST`.
- There is no local try/catch around the second decode.
- `src/state/user/sagas.ts::saga` places `call(handleRedirectSaga)` in the same `all([...])` as the login/register/logout and other user watchers.
- `src/state/rootSaga.ts::rootSaga` places `userSaga()` in the root `all([...])` alongside geolocation, orders, cars, client-order and other domain sagas.
- `src/tools/sagaUtils.ts::call` delegates to Redux-Saga's `call`; it does not catch or suppress generator exceptions.

**Concrete trigger:**
- Query: `?auth_hash=%25`
- URLSearchParams decodes `%25` to the literal percent character `%`.
- `decodeURIComponent('%')` throws `URIError: URI malformed`.
- A similarly malformed residual escape such as `%ZZ` also throws.

**Impact:**
- The exception escapes `handleRedirectSaga`, fails the user saga's `all`, then propagates into the root saga's `all`.
- Under Redux-Saga fail-fast `all` behavior, sibling saga effects are cancelled. The app shell may still render, but saga-driven application workflows can stop for the current page session.
- This is a crafted-link/client-side denial-of-service condition; it does not establish server compromise, authentication bypass or data disclosure.

**Recommended action:**
- Remove the second `decodeURIComponent`. Treat values returned by `URLSearchParams.get()` as already decoded.
- Make startup redirect parsing failure-isolated: catch malformed parameters locally and continue starting all application watchers.
- Validate that `auth_hash` is a non-empty string with the expected format/length before dispatching the auth action. Do not log the raw value.
- Add tests for absent, ordinary, percent-containing, malformed UTF-8, residual-percent and malformed escape values.
- Add a root-saga regression test proving malformed redirect input does not cancel unrelated domain watchers.

**Unverified:** exact Redux-Saga runtime cancellation behavior for this repository's installed version has not been executed in a test; the conclusion follows from the source effect tree and Redux-Saga's documented fail-fast `all` semantics. No deployed browser session was tested.

### URL-47-02 — Referral prefill parameters are decoded twice and can throw in component effects

**Severity: P2 (Medium; referral-prefill availability and robustness).**

**Observed in source:**
- `src/components/modals/index.tsx::ModalHost` obtains `u_email` and `u_name` from `URLSearchParams`, then applies `decodeURIComponent` to each before dispatching `setRefCodeModal`.
- `src/components/modals/LoginModal/Login.tsx::getParamFromURL` performs the same sequence: `URLSearchParams(location.search).get(param)`, then `decodeURIComponent(value)`.
- The LoginForm effect subsequently decodes the returned values again when building the prefilled registration object.
- No local error handling surrounds these decoding operations.

**Impact:**
- A URL containing `u_email=%25&u_name=Test` yields a literal `%` for email after URLSearchParams; the second decode throws.
- The referral prefill flow fails for that page load and may emit an uncaught effect error.
- The reviewed values are used as form prefill fields. No HTML sink or arbitrary navigation use was found in these call paths.

**Recommended action:**
- Remove all redundant second decoding.
- Validate email/name as form data at the form boundary; do not interpret URL parameters as markup.
- If parsing is intentionally defensive, catch errors locally and ignore only the malformed prefill rather than allowing an exception to escape the effect.
- Add tests for encoded spaces, plus signs, Unicode, literal percent characters and malformed percent sequences.

**Unverified:** whether the two referral-prefill effects are both mounted for every route and the exact user-visible behavior under malformed input; no browser test was run.

## Navigation and URL-handling search reconciliation

The source search for browser navigation found:
- `MessageModal.tsx` — tenant-configured `window.open`, already covered by stage 46.
- `MiniOrder` and `CardModal` — `tel:` and fixed-origin `https://wa.me/` contact actions; the scheme/origin are fixed in source, so no arbitrary open redirect was established. Phone path segments are not explicitly encoded/validated, but this is not evidence of script execution.
- `PassengerLiveOrder` and `VotingForm` — fixed `tel:` contact actions.
- Google OAuth anchor — fixed `https://accounts.google.com` origin and configured redirect URI; no user-controlled redirect destination was found in this source path.
- `config.ts` query selector — already covered by stages 08 and 45.
- No source matches were returned for `location.assign(` or `location.replace(` in the frontend search performed for this stage.

This is a source-search reconciliation, not a claim that every navigation behavior or browser URL sink has been exhaustively verified.

## Relationship to earlier stages

- **Stage 26:** authentication and route boundaries remain separate; URL-47-01 adds a startup failure path in the Google redirect parser.
- **Stage 45:** runtime tenant configuration is unrelated to this query-decoding defect.
- **Stage 46:** tenant support navigation is the only observed arbitrary `window.open` path; fixed `tel:` and `wa.me` contact links do not share that arbitrary-scheme behavior.

## Test and execution status

- Tests executed: none.
- Root-saga cancellation reproduced: no.
- Malformed URL loaded in browser: no.
- Authentication/API calls: none.
- Application source changed: no.
