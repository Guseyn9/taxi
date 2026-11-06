# Stage 45 — Runtime configuration and dynamic HTML trust boundaries

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace the runtime tenant selector through remote script loading, identify consumers of the resulting `window.data`, deepen the JSON-form HTML-sink source chain, and inspect the public Sandbox HTML-rendering path.
- Source review only. No script payload was executed, no live config endpoint was requested, no deployed bundle or response headers were inspected, and no tests were run.
- No application source, tests, runtime configuration or CI files were changed. This stage adds documentation only.

## Executive result

The source review confirms three related trust boundaries:

1. The startup `?config=` query parameter is accepted before the app's separate `API.checkConfig` flow. Its value is only trimmed/defaulted, stored in localStorage, and interpolated into the path of a remote JavaScript file on the fixed `ibronevik.ru` origin. This is a tenant/config selector that chooses executable code, not a JSON data fetch. No allowlist or path-segment validation is visible.
2. The remote script populates `window.data`. Registration and profile JSON forms are parsed directly from `window.data.site_constants`; checkbox labels are translated using the same runtime dictionary and passed to `dangerouslySetInnerHTML`. This supplies the missing source provenance for the conditional sink already recorded in AUTH-26-06. A party able to alter the tenant's form/dictionary configuration can supply HTML to this sink. Whether such a party exists outside trusted tenant administrators, and whether any such content is attacker-controlled in production, remain unverified.
3. The public `/sandbox` route accepts locally imported or locally stored JSON and renders default Block content through `react-html-parser` without a visible sanitizer. The reviewed data path is local to that browser profile; no cross-user persistence or remote attacker-controlled source was established. Treat it as an unsafe local-content preview surface, not as a demonstrated remotely exploitable XSS.

The stage does **not** establish arbitrary-origin script injection, unauthenticated remote code execution, a production exploit, or a backend authorization defect.

## Findings

### CFG-45-01 — Startup tenant selector chooses an executable remote script without an allowlist

**Severity: Medium (P2 hardening; runtime trust boundary).**

**Observed in source:**
- `src/config.ts` reads `config` from `URLSearchParams(window.location.search)` during module initialization.
- If present, it calls `this.setConfig(configParam)` directly. This path does not call `API.checkConfig`.
- `normalizeConfigName` only trims whitespace and maps an empty string or `0` to `DEFAULT_CONFIG_NAME`; it does not validate a tenant identifier, reject separators, or enforce an allowlist.
- `setConfig` stores the supplied value in localStorage and passes it to `applyConfigName`.
- `applyConfigName` constructs `https://ibronevik.ru/taxi/cache/data_${configName}.js?ver=${ver}`, creates a script element and appends it to the document.
- The query parameter is subsequently removed from the visible URL, but the selected value remains in localStorage.
- The separate `API.checkConfig` method exists in `src/API/index.ts` and is used by `state/config/sagas.ts::checkConfigSaga`; it is not part of the constructor's initial query-parameter path.

**Impact and qualification:**
- A link can select a different tenant/configuration before the app starts using it. This can cause the browser to execute a different JavaScript configuration file and then consume its `window.data` values.
- The script origin is hard-coded to `ibronevik.ru`; this source does not permit directly replacing it with an arbitrary external hostname.
- Because the tenant value is inserted into a URL path without validation, path-separator/path-normalization behavior deserves explicit server/browser verification. The source review did not establish that a crafted value can reach an unintended executable resource, so path traversal or arbitrary same-origin script execution is **not** claimed as a confirmed exploit.
- The more fundamental risk—the use of remotely supplied executable JavaScript as tenant configuration—was already recorded as EXT-07 in stage 08. This stage adds the direct startup path and missing validation detail rather than duplicating that finding.

**Recommended action:**
- Replace executable tenant configuration with JSON fetched as data, parsed and schema-validated.
- Until migration, validate tenant names against a strict allowlist/identifier grammar on both client and server; reject slashes, backslashes, dots, percent-encoded separators and unexpected characters.
- Route initial `?config=` selection through the same validation/check path as interactive selection. Do not persist or load a configuration until validation succeeds.
- Add tests for empty/default values, valid tenant identifiers, traversal-like values, encoded separators, query/hash characters and failed config validation.

**Unverified:** actual CDN/origin path handling, the server's accepted tenant namespace, publishing permissions for tenant scripts, deployed config contents, and whether any crafted selector can resolve to a different executable resource.

### CFG-45-02 — Remote registration/profile schema and dictionary feed an unsanitized checkbox HTML sink

**Severity: High if tenant configuration or dictionary content is writable by an untrusted party; otherwise a privileged-content injection risk.**

**Observed in source:**
- `src/components/modals/LoginModal/RegisterJSON.tsx` reads `window.data.site_constants.form_register.value`, parses it as JSON and passes its `fields` to `JSONForm`.
- `src/components/modals/ProfileModal.tsx::getProfileFields` similarly reads and parses `window.data.site_constants.form_profile.value`.
- `src/components/JSONForm/JSONFormElement.tsx` handles checkbox labels by evaluating the configured label, resolving it with `getTranslation`, and assigning the result to `dangerouslySetInnerHTML.__html`.
- `src/localization/index.ts::t` resolves translations from `window.data` (with bundled fallbacks for selected keys). Thus both the field schema and a translated label can originate in the runtime tenant script/dictionary.
- The sink is in the user-facing registration/profile form path, not only in the Sandbox.

**Impact and qualification:**
- A malicious or compromised tenant form/dictionary value can place HTML into a DOM sink. This is a concrete source-to-sink path and materially strengthens the provenance analysis for AUTH-26-06.
- This is not evidence that an ordinary passenger or driver can edit tenant configuration, nor that the current production tenant contains hostile values. The source of authority and publishing controls for `form_register`, `form_profile` and localization entries are outside this frontend repository.
- The remote config script itself executes as JavaScript; compromise of that script host already crosses the browser trust boundary (EXT-07). The HTML sink remains a separate unsafe rendering decision because it also grants HTML interpretation to fields that are intended to be labels.

**Recommended action:**
- Render checkbox labels as text by default. If limited markup is a product requirement, sanitize against a narrow explicit allowlist before rendering; do not pass raw tenant strings to `dangerouslySetInnerHTML`.
- Validate the form schema and label type/length at the data boundary. Do not treat tenant-controlled data as safe merely because it is served by the configured host.
- Add regression tests using hostile labels and translations (for example event-handler attributes, dangerous URL schemes, malformed markup and SVG payloads) and assert that no executable DOM behavior is produced.
- Document which roles can publish tenant form schemas and translation dictionaries; restrict and audit those permissions.

**Unverified:** backend/admin write permissions, tenant publishing workflow, current live form/dictionary contents, deployed sanitizer/CSP behavior, and exploitability under the actual production tenant.

### CFG-45-03 — Public Sandbox renders locally supplied HTML-capable blocks without a visible sanitizer

**Severity: Low (local preview/self-XSS risk; no remote exploit established).**

**Observed in source:**
- `src/platform/platform-interface/navigation/routes.ts` registers `/sandbox`.
- `src/Routes.tsx` renders `<Sandbox />` on that route without an explicit route-level authentication/role guard.
- `src/pages/Sandbox/index.tsx` loads settings from localStorage, allows importing a local JSON file, and persists editor changes back to localStorage.
- `src/components/ConstructorTab/index.tsx` maps `settings.blocks` into `Block`.
- `src/components/Block/index.tsx` sends the default block type to `HTML`.
- `src/components/HTML/index.tsx` passes the block's `html` string through `ReactHtmlParser`; no sanitizer or allowlist is visible in this call path.

**Impact and qualification:**
- A user can preview HTML-capable content in their own browser context through the public Sandbox.
- The reviewed source path is driven by that browser's imported/localStorage JSON. No shared server storage, cross-user delivery, remote configuration feed or attacker-to-victim propagation was found in this path.
- The behavior of dangerous attributes/URL schemes in the installed `react-html-parser` version was not dynamically tested. Do not classify this as confirmed script execution.

**Recommended action:**
- If Sandbox is development-only, remove it from production route registration/builds. Otherwise protect it with an explicit authorization boundary.
- Treat imported JSON as untrusted. Remove the HTML block or sanitize it with a strict allowlist before parsing.
- Add file size/depth/schema limits and hostile-markup tests; the existing unbounded JSON import concern remains separately recorded in stage 27.

**Unverified:** production route availability, actual library parsing behavior for hostile payloads, and whether any external workflow distributes Sandbox JSON to other users.

## Dynamic execution and HTML-sink search coverage

Within the frontend source search performed for this stage:
- `document.createElement('script')` / dynamic script source: `src/config.ts`.
- `dangerouslySetInnerHTML`: `src/components/JSONForm/JSONFormElement.tsx`.
- `react-html-parser`: `src/components/HTML/index.tsx`.
- `eval(`: `src/tools/order.ts`, already covered by stage 44.
- No additional frontend matches were returned for `srcdoc`, `insertAdjacentHTML`, `document.write` or `javascript:`.
- The `new Function` search was not a reliable exact-token search (GitHub returned broad substring matches); no additional dynamic Function sink is claimed from it.

This is a repository code-search result, not proof that every possible dynamic execution primitive or dependency behavior has been exhaustively tested.

## Relationship to earlier stages

- **Stage 08 / EXT-07:** already records remote executable tenant configuration. CFG-45-01 adds the startup query path, the missing allowlist and the distinction between constructor loading and the separate API check flow.
- **Stage 26 / AUTH-26-06:** already records the JSON-form checkbox HTML sink conditionally. CFG-45-02 traces the actual remote form-schema and localization sources into that sink; it does not assert that an ordinary user controls those sources.
- **Stage 27:** already records unbounded Sandbox JSON import. CFG-45-03 traces the import/localStorage path into the public Sandbox's HTML-capable Block default renderer.
- **Stage 44:** the pricing `eval()` finding remains a separate P1 security gate.

## Frontend closure gates

Do not close the frontend security/configuration track until:
1. tenant configuration is no longer executable remote JavaScript, or the interim tenant selector and publishing trust boundary have strict validation and documented controls;
2. checkbox labels are text-only or safely sanitized, with hostile-input regression tests;
3. Sandbox is excluded from production or protected and its imported HTML is sanitized/removed;
4. the existing stage 44 `eval()` sink is removed and covered by restricted-parser tests.

## Test and execution status

- Tests executed: none.
- Production build / TypeScript: not run.
- Live API/config/CDN checks: not run.
- Payload execution: not attempted.
- Application source changed: no.
