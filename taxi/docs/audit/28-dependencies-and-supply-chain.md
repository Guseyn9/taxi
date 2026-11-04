# Stage 28 — Dependencies and software supply chain

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Manifests: `taxi/package.json`, `taxi/package-lock.json`
- Lock format: npm lockfile v3
- Dependency inventory: 2,124 package entries in `package-lock.json`.
- Date of advisory cross-check: 2026-11-04.
- No application source changed.

## Executive result

The lockfile is present and pins exact package versions, but the baseline contains several versions within published vulnerable ranges. The clearest high-priority findings are:
- `webpack-dev-server@5.2.0`, affected by multiple 2026 advisories; the project binds the development server to `0.0.0.0` by default and configures `allowedHosts: 'all'`.
- `postcss@8.5.2`, affected by several 2026 advisories involving attacker-controlled source-map comments and CSS stringification.
- `minimatch@3.0.4`, affected by published ReDoS advisories.
- `loader-utils@1.2.3` in the local `react-dev-utils` dependency tree, within the affected range for a critical prototype-pollution advisory.
- `cross-spawn@7.0.1` in the local `react-dev-utils` dependency tree, within the affected range for a high-severity ReDoS advisory.
- `axios@0.21.4`, within the affected range for CVE-2023-45857. The advisory's concrete impact depends on browser cookie/XSRF behavior and request context; no explicit `withCredentials` or custom XSRF configuration was found in the searched application code.

These are version/advisory matches, not proof that every vulnerable code path is reachable from untrusted input. Several packages are build/development tooling, so the main exposure is developer/CI/build environment rather than the deployed browser bundle. Reachability and exploitability must be established before assigning an incident severity.

## 1. Lockfile and package management

### SUPPLY-28-01 — Lockfile is committed, but no automated advisory gate is explicit in the E2E workflow

**Severity: Medium**

**Observed:**
- Root `package.json` declares npm dependencies and Node engine `24.x`.
- `package-lock.json` uses lockfile version 3 and records 2,124 package entries.
- GitHub Actions E2E workflow uses `actions/setup-node@v4`, reads the Node version from `taxi/package.json`, caches npm, and runs `npm ci`.
- No explicit `npm audit`, OSV scanner, SCA/SBOM generation or license-check command appears in the inspected E2E workflow.
- No repository `.npmrc`, `.yarnrc`, pnpm lockfile or Dependabot configuration was found at the inspected paths. This does not establish GitHub Security/Dependabot settings for the repository.

**Impact:** a reproducible install does not by itself ensure dependencies are free of known vulnerabilities. An advisory can be published after a lockfile is committed; without an explicit recurring scan and policy gate, it can remain undetected.

**Recommendation:**
- Add a dedicated dependency audit workflow on pull requests and a scheduled cadence.
- Run `npm audit --json` or an equivalent OSV/GitHub Advisory scanner and retain machine-readable results.
- Separate production/runtime dependencies from build/test-only dependencies in reports; fail CI on defined severity thresholds with documented, time-bounded exceptions.
- Generate an SBOM (CycloneDX or SPDX) for each release and archive it with build provenance.
- Enable Dependabot security updates or an equivalent automated alert/remediation mechanism, and verify repository settings rather than assuming they are enabled.

## 2. Confirmed version/advisory matches

### SUPPLY-28-02 — webpack-dev-server 5.2.0 is in multiple affected ranges

<badge>High for exposed development environments</badge>

**Observed:** lockfile pins `webpack-dev-server@5.2.0`; root manifest declares it in `devDependencies`. The project starts it in `scripts/start.js`. `scripts/start.js` defaults `HOST` to `0.0.0.0`; `config/webpackDevServer.config.js` also defaults to `0.0.0.0` and sets `allowedHosts: 'all'`.

**Advisory matches:**
- GHSA-9jgg-88mc-972h / CVE-2025-30360: affected through 5.2.0; fixed in 5.2.1.
- GHSA-79cf-xcqc-c78w / CVE-2026-6402: affected through 5.2.3; fixed in 5.2.4.
- GHSA-mx8g-39q3-5c79 / CVE-2026-9595: affected before 5.2.5; fixed in 5.2.5.
- GHSA-f5vj-f2hx-8m93 / CVE-2026-14620: affected through 5.2.5; fixed in 5.2.6.
- GHSA-m28w-2pqf-7qgj / CVE-2026-14631: affected through 5.2.5; fixed in 5.2.6.

**Impact:** depending on network reachability, browser and proxy setup, vulnerable development servers can expose source bundles cross-origin, permit cross-site triggering of developer endpoints, leak HMR-related headers through permissive proxies or be crashed by malformed headers. The default all-interface bind and permissive host policy increase exposure if a developer or CI environment is reachable from an untrusted network.

**Recommendation:**
1. Upgrade to at least `webpack-dev-server@5.2.6`; prefer the latest compatible patched 5.2.x release after regression testing.
2. Bind local development to `127.0.0.1` unless LAN access is deliberately required.
3. Replace `allowedHosts: 'all'` with an explicit allowlist.
4. Do not expose dev servers to public/untrusted networks; firewall CI workers and developer machines.
5. Review proxy configuration, especially broad contexts and `ws: true`.

**Reachability qualification:** the advisories apply to the installed version. Actual exploitability depends on dev server being running and reachable, browser/proxy conditions and attacker access. This is not a production browser-bundle vulnerability by itself.

### SUPPLY-28-03 — PostCSS 8.5.2 is affected by multiple 2026 advisories

<badge>High in untrusted build-input scenarios</badge>

**Observed:** lockfile pins `postcss@8.5.2`. It is used by the Webpack CSS loader pipeline in `config/webpack.config.js` together with `postcss-loader`, preset-env, flexbugs fixes and normalize plugins.

**Advisory matches:**
- GHSA-qx2v-qp2m-jg93 / CVE-2026-41305: XSS in CSS stringification output; affected before 8.5.10.
- GHSA-6g55-p6wh-862q / CVE-2026-45623: attacker-controlled `sourceMappingURL` in CSS comments can read local map files; affected before 8.5.12.
- GHSA-r28c-9q8g-f849 / CVE-2026-73646: path traversal in previous source-map auto-loading; affected before 8.5.18.
- GHSA-fxqj-rqcc-2cmp / CVE-2026-69153: incomplete fix involving attacker-controlled sourceMappingURL when `from` is unset; affected through 8.5.22.

**Impact:** a build that processes attacker-controlled CSS/source-map comments may expose local source-map files or create unsafe CSS output, depending on exact processing options and input provenance. This is a build-toolchain risk, not evidence of an exploitable production endpoint.

**Recommendation:** update PostCSS to at least 8.5.23 (or a later compatible patched release), review the full PostCSS plugin compatibility matrix, and avoid processing untrusted CSS in privileged build environments. Ensure the build pipeline supplies a trustworthy `from` path and disables unnecessary previous-map loading where appropriate.

**Reachability qualification:** repository CSS and third-party CSS provenance were not exhaustively traced; no malicious CSS reproduction was run.

### SUPPLY-28-04 — minimatch 3.0.4 is affected by ReDoS advisories

**Severity: High if attacker-controlled glob patterns reach minimatch**

**Observed:** lockfile pins `minimatch@3.0.4`. Reverse dependency inspection shows it is used by several tooling packages, including ESLint-related packages, `filelist`, `glob`, `jake`, `recursive-readdir` and `test-exclude`.

**Advisory matches:**
- GHSA-3ppc-4f35-3m26 / CVE-2026-26996: repeated wildcard patterns can trigger catastrophic backtracking; all minimatch 3.x versions before 3.1.3 are affected.
- GHSA-7r86-cg39-jmmj: ReDoS via multiple non-adjacent GLOBSTAR segments; affected legacy 3.x versions before 3.1.3.

**Impact:** a crafted glob pattern can consume excessive CPU. Exposure depends on whether an attacker can influence patterns passed into the affected matching call sites.

**Recommendation:** move the 3.x dependency to at least 3.1.3 where semver/API compatibility permits; otherwise upgrade the owning packages or use a tested override. Add tests for hostile glob patterns and review all user-controlled glob inputs. Do not apply a major minimatch override blindly because API/behavior changes may break callers.

### SUPPLY-28-05 — loader-utils 1.2.3 is in the affected prototype-pollution range

<badge color="danger">Critical advisory; reachability unconfirmed</badge>

**Observed:** local package `lib/react-dev-utils/package.json` pins `loader-utils@1.2.3`; lockfile resolves it at `lib/react-dev-utils/node_modules/loader-utils`. Other loaders also declare loader-utils dependencies.

**Advisory match:** GHSA-76p3-8jx3-jpfq / CVE-2022-37601 affects loader-utils versions before 1.4.1 (and 2.x before 2.0.3). The vulnerable `parseQuery` function can permit prototype pollution.

**Impact:** if attacker-controlled loader query strings reach the vulnerable parser during a build, prototype pollution may affect the Node.js build process. The advisory has critical CVSS severity, but this report has not demonstrated an attacker-controlled query path or a reachable exploit in this repository.

**Recommendation:**
- Upgrade the local `react-dev-utils` dependency to a maintained compatible version that uses patched loader-utils.
- Audit the other loader-utils copies/consumers in the lockfile and ensure all resolved versions are patched.
- Treat build-time configuration and loader query strings as trusted only after provenance review.
- Do not patch only the root `node_modules/loader-utils` if nested copies remain vulnerable.

### SUPPLY-28-06 — cross-spawn 7.0.1 is affected by ReDoS advisory

**Severity: High if attacker-controlled strings reach vulnerable argument handling**

**Observed:** local `lib/react-dev-utils/package.json` pins `cross-spawn@7.0.1`; lockfile has `lib/react-dev-utils/node_modules/cross-spawn@7.0.1`. A separate top-level `cross-spawn@6.0.6` is present and is at the patched 6.x version.

**Advisory match:** GHSA-3xgq-45jj-v275 / CVE-2024-21538 affects 7.x before 7.0.5 and 6.x before 6.0.6.

**Impact:** specially crafted input can cause regular-expression denial of service. The vulnerable 7.0.1 copy is part of the local build utility package's dependency tree; no user-controlled argument reaching it was demonstrated.

**Recommendation:** update the local `react-dev-utils` dependency to use cross-spawn 7.0.5 or later, or use a compatibility-tested override. Confirm nested dependency resolution after remediation.

### SUPPLY-28-07 — Axios 0.21.4 is within the CVE-2023-45857 affected range

**Severity: Medium; configuration-dependent**

**Observed:** lockfile pins `axios@0.21.4`; root manifest range is `^0.21.1`. The package is used throughout browser API calls.

**Advisory match:** GHSA-wf5p-g6vw-rhxx / CVE-2023-45857 affects Axios >=0.8.1 and <0.28.0 (and 1.x before 1.6.0). The advisory describes leakage of XSRF cookie data through the `X-XSRF-TOKEN` header on requests to other hosts.

**Impact:** the concrete risk depends on browser adapter behavior, XSRF cookie presence, cross-origin destinations and credentials/request configuration. A repository search did not find explicit `withCredentials`, `xsrfCookieName` or `X-XSRF-TOKEN` configuration. This does not prove the default behavior is safe in all deployed contexts.

**Recommendation:** upgrade to a currently supported patched Axios release after reviewing breaking changes and API compatibility. Explicitly set trusted API origins, review cookie/XSRF behavior and avoid sending credentials to arbitrary URLs. Add regression tests for cross-origin requests with an XSRF cookie present.

## 3. Other supply-chain observations

### SUPPLY-28-08 — Local vendored package is a material part of dependency tree

**Severity: Medium (maintenance/provenance)**

**Observed:** root manifest resolves `react-dev-utils` from `./lib/react-dev-utils`, not from a pinned registry tarball. Its package manifest includes many older pinned dependencies, including vulnerable `loader-utils@1.2.3` and `cross-spawn@7.0.1`. A second copy exists under `src/lib/react-dev-utils`, but root package resolution points to `lib/react-dev-utils`.

**Impact:** upstream fixes are not inherited automatically. The local package may diverge from upstream while appearing to have the same package name/version. Auditing only root direct dependencies or the public npm package version would miss nested vulnerable copies.

**Recommendation:** document the fork origin and exact upstream commit; maintain a patch log; periodically rebase onto a maintained upstream version; scan the local package manifest and its complete nested dependency graph. Remove duplicate source copies if they are genuinely unused, or document why they must remain.

### SUPPLY-28-09 — Alternate package_fixed.json creates a second manifest-like file

**Severity: Low/Medium**

**Observed:** `taxi/package_fixed.json` is present and resembles `package.json`, but its scripts and devDependencies differ (for example, it omits the Playwright dependency and has different prepare-build behavior). npm uses `package.json`, not this alternate filename, for normal install/build operations.

**Impact:** developers or automated scripts may mistake this file for the canonical manifest and use an incomplete or outdated dependency/script definition. It also complicates dependency review and release reproducibility.

**Recommendation:** remove it if obsolete, or rename it to an explicitly documented fixture/template and add a check that makes its non-canonical status clear. Keep one authoritative manifest and lockfile.

### SUPPLY-28-10 — Six packages declare install scripts in the lockfile

**Severity: Informational / review required**

**Observed:** lockfile records install scripts for:
- `@parcel/watcher@2.5.0`
- `core-js@3.40.0`
- `es5-ext@0.10.64`
- `fsevents@2.3.3`
- nested `fsevents@1.2.11`
- Playwright's nested `fsevents@2.3.2`

**Impact:** install scripts execute code during dependency installation and therefore belong to the supply-chain trust boundary. Native modules may compile or download platform-specific artifacts. Their presence is not itself suspicious or malicious.

**Recommendation:** keep lockfile integrity checks, use trusted npm registry/provenance, review package maintainers/releases, and use `npm ci --ignore-scripts` only where compatible with required native/browser setup. Do not disable all scripts without testing because some dependencies require them.

### SUPPLY-28-11 — License metadata is incomplete for many lock entries

**Severity: Low / compliance review**

**Observed:** 905 of 2,124 lockfile package entries do not carry a `license` field in the lock metadata. This includes packages where npm metadata may be absent or declared through a LICENSE file rather than the lockfile field.

**Impact:** automated license reporting based only on lockfile metadata may classify packages as unknown. This is not evidence that 905 packages are unlicensed or non-compliant.

**Recommendation:** generate a license inventory from resolved package metadata and package contents, manually review unknown/proprietary/copyleft licenses, and retain an approved-license policy and attribution bundle for distribution.

## 4. Runtime vs build-time classification

| Package | Locked version | Main role in this repository | Advisory status |
|---|---:|---|---|
| axios | 0.21.4 | Browser API client | Affected range; browser/XSRF applicability needs review |
| webpack-dev-server | 5.2.0 | Local development server | Multiple affected advisories; network exposure matters |
| postcss | 8.5.2 | CSS build pipeline | Multiple affected advisories; untrusted CSS/build input matters |
| minimatch | 3.0.4 | Glob matching in tooling dependency graph | ReDoS affected range |
| loader-utils | 1.2.3 | Loader/build tooling | Critical prototype-pollution affected range |
| cross-spawn | 7.0.1 | Local build utility dependency | ReDoS affected range |
| follow-redirects | 1.15.9 | Axios transitive dependency | No finding asserted in this report |
| jsoneditor | 9.7.4 | Sandbox/editor UI | Old version; no specific advisory confirmed here |
| react-html-parser | 2.0.2 | HTML parsing dependency | Old package; no direct advisory confirmed here; separately review HTML trust/sanitization |
| jest | 24.9.0 | Test runner | Old generation; support/maintenance concern, not a specific vulnerability claim |

## 5. Remediation order

1. Upgrade `webpack-dev-server` to a patched version and restrict its bind address/allowed hosts.
2. Upgrade PostCSS to at least 8.5.23 and validate CSS build behavior.
3. Patch nested `loader-utils` and `cross-spawn` in the local `react-dev-utils` dependency tree.
4. Upgrade `minimatch` to patched compatible releases through owning dependencies/overrides.
5. Upgrade Axios from 0.21.4 to a currently supported patched version and regression-test browser API behavior.
6. Add scheduled SCA/advisory scanning, SBOM and license inventory.
7. Remove or formally label `package_fixed.json`; document local fork provenance.

Do not apply a single blanket override to all transitive dependencies without running unit tests, TypeScript checks, production build and Playwright E2E. Several findings involve legacy packages and changing their major/minor versions can break the custom Create React App-derived build toolchain.

## Files reviewed

- `taxi/package.json`
- `taxi/package-lock.json`
- `taxi/package_fixed.json`
- `taxi/lib/react-dev-utils/package.json`
- `taxi/lib/react-leaflet-fullscreen-plugin/package.json`
- `taxi/scripts/start.js`
- `taxi/config/webpackDevServer.config.js`
- `taxi/config/webpack.config.js`
- `.github/workflows/e2e.yml`
- `taxi/.gitignore`

## Limitations

- A live `npm audit`, OSV scan or full dependency scanner was not executed in this audit environment.
- Advisory matches were checked against published GitHub Advisory Database pages and package versions from the pinned lockfile.
- No exploit reproduction was performed.
- Dependency reachability was inspected only for selected packages; this is not a full call-graph/SCA reachability analysis.
- No production build bundle analysis was run to prove which dependencies are shipped to the browser.
- GitHub repository security-alert/Dependabot settings were not inspected.
- No license approval decision was made; missing lockfile metadata is not proof of missing license.
- All source observations are pinned to `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`; current deployment dependencies may differ if the deployed artifact was built from another commit or install state.
