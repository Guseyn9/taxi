# Stage 46 — Tenant-configured support navigation and window opener boundary

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace the support destination used by the shared message modal, identify its source and validation, and assess the browser navigation boundary.
- Source review only. No configured support value was retrieved from a live tenant, no URL was opened, and no browser behavior was tested.
- No application source, tests, runtime configuration or CI files were changed. This stage adds documentation only.

## Executive result

The shared `MessageModal` obtains its support destination from `window.data.site_constants.support_link`, then `support_url`, then `support_email`. When the modal is in warning/failure state, its support action converts the value to a string and passes it to `window.open(href, '_blank')`.

The only normalization is a heuristic that prefixes `mailto:` when the string contains `@` and does not already start with `mailto:`. There is no URL parser, protocol allowlist, origin restriction, or explicit `noopener` feature. Therefore tenant configuration controls a browser navigation target, including its scheme, and a newly opened page may retain an opener relationship.

This is a conditional trust-boundary issue, not proof of an active exploit. The support value is read from the same remotely supplied `window.data` tenant configuration described in stages 08 and 45. The ability of an untrusted party to change that value, the current live value and the exact browser handling of dangerous schemes are unverified.

## Finding

### NAV-46-01 — Tenant-configured support destination is passed to window.open without scheme validation or opener isolation

**Severity: Medium (P2; high only if the tenant value is writable by an untrusted party).**

**Observed in source:**
- `src/components/modals/MessageModal.tsx` reads the first available value from:
  - `window.data.site_constants.support_link.value`
  - `window.data.site_constants.support_url.value`
  - `window.data.site_constants.support_email.value`
- The support button is rendered for non-success modal variants when a support value exists.
- `handleSupportAction` converts the value to a string. If it contains `@` and does not start with `mailto:`, it prefixes `mailto:`; otherwise it uses the value unchanged.
- It calls `window.open(href, '_blank')`.
- No `new URL` validation, protocol allowlist, destination-origin policy, or `noopener` feature is present in this call path.
- Repository code search found no other source references to these three support configuration keys; this component is the observed consumer.

**Impact and qualification:**
- A configured `https:` destination can send a user to an arbitrary external site. If the tenant configuration is changed by an untrusted or compromised actor, this creates a phishing/navigation redirection surface.
- A value using a script-capable or otherwise dangerous scheme is not rejected in source. Whether a particular scheme executes in a newly opened context depends on browser behavior and policy; no execution is claimed.
- Opening a new context without explicit `noopener` may expose the originating page through `window.opener` to the destination, creating a reverse-tabnabbing risk where the browser and destination permit it.
- The existing tenant configuration script is already an executable trust boundary (stage 08 EXT-07 / stage 45 CFG-45-01). This finding is narrower: even if configuration is migrated to inert JSON, the support URL remains an independently consumed navigation value and must be validated.
- The frontend repository does not establish who may edit tenant support values or whether production configuration is currently safe.

**Recommended action:**
- Parse the configured destination with `URL`; allow only explicit schemes required by the product (normally `https:` and `mailto:`). Reject `javascript:`, `data:`, protocol-relative URLs, malformed values and unexpected schemes.
- If only one support website is intended, use a fixed/allowlisted hostname rather than arbitrary external URLs.
- Open external pages with explicit opener isolation (for example `noopener,noreferrer`) and do not rely on browser defaults.
- Replace the `includes('@')` heuristic with typed configuration fields: a validated support URL and a separately validated email address.
- Add unit tests for valid HTTPS, valid mailto, malformed values, URL strings containing `@`, protocol-relative URLs and dangerous schemes. Add a browser test that verifies opener isolation.

**Unverified:**
- Live tenant values and the configuration publishing/authorization workflow.
- Browser behavior for dangerous schemes under the actual production CSP and browser matrix.
- Whether deployed configuration currently points to an approved support destination.
- Whether external destination pages can access `window.opener` in the supported runtime/browser set.

## Relationship to earlier stages

- **Stage 08 / EXT-07:** records the remote executable tenant configuration source.
- **Stage 45 / CFG-45-01:** traces the startup tenant selector and lack of allowlist; this stage traces another consumer of the resulting `window.data`.
- **Stage 29:** response security headers and deployed CSP remain unverified; no claim is made that CSP mitigates this navigation behavior.
- **Stage 26:** route authentication and browser security findings remain separate.

## Test and execution status

- Dedicated MessageModal support-navigation test found: none in the repository search performed for this stage.
- Tests executed: none.
- Browser navigation / opener test: not run.
- Live config/API checks: not run.
- Application source changed: no.
