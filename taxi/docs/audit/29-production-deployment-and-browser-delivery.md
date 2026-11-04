# Stage 29 — Production deployment, HTTP policy and browser delivery

## Scope and evidence baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Reviewed: Vercel configuration copies, build script and Webpack production settings, HTML entry point, service-worker code, startup cache cleanup, and the external analytics guard.
- No application source or deployment configuration was modified.
- No live production HTTP response, deployed Vercel project setting, CDN configuration or browser session was inspected. Findings below describe repository configuration, not verified production behavior.

## Executive result

The repository has a static Vercel deployment configuration with several concrete concerns:

1. The configured production build explicitly disables Webpack minification (`WEBPACK_SKIP_MINIFY=true`). Source maps are disabled (`GENERATE_SOURCEMAP=false`), but unminified JavaScript is still shipped.
2. The global CORS header sets `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin: https://chat.itest24.com/`. The trailing slash is not part of a serialized web origin and is likely to prevent browsers from matching the requesting origin. The global CORS policy also applies to static assets where it may not be needed.
3. The Vercel configuration declares no Content-Security-Policy, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy or frame-embedding policy. These may be supplied in Vercel dashboard settings, an upstream proxy or another layer; their absence from this file is not proof they are absent in production.
4. The public directory contains another copy of `vercel.json`. The build script copies the public directory into the output directory, so this duplicate configuration file is likely published as a static asset at `/vercel.json`.
5. The app calls `serviceWorker.unregister()` at startup, and the custom public service worker unregisters itself while deleting every Cache Storage entry if it is ever activated. This is consistent with disabling legacy service-worker caching, but broad cache deletion can affect unrelated same-origin applications sharing the origin.
6. The early-loaded `external-analytics-guard.js` monkey-patches browser APIs and DOM insertion methods to block two URL patterns. It is a compatibility workaround, not a reliable security boundary.

## Findings

### DEPLOY-29-01 — Production JavaScript minification is explicitly disabled

**Severity: Medium (performance, distribution and code-disclosure hygiene).**

**Observed:**
- `taxi/vercel.json` build command sets `WEBPACK_SKIP_MINIFY=true`.
- `taxi/config/webpack.config.js` configures `optimization.minimize` as false when that variable equals the string `true`.
- The same build command sets `GENERATE_SOURCEMAP=false`, so production source maps are disabled through the standard Webpack option.
- The build script still produces a production-mode Webpack bundle; disabling minification does not turn it into a development build.

**Impact:**
- Larger JavaScript assets, potentially slower downloads and parse/compile time, especially on mobile networks/devices.
- Original formatting, comments and symbol names may remain more readable in distributed bundles. This is not equivalent to publishing source maps or source files, but it reduces the effort needed to inspect client-side implementation.
- Client-side code and any values compiled into it are never secret, regardless of minification. Minification is not a security control.

**Recommendation:**
- Remove `WEBPACK_SKIP_MINIFY=true` from the production deployment command unless there is a documented, measured reason.
- Keep `GENERATE_SOURCEMAP=false` for public production artifacts unless source maps are uploaded privately to an error-monitoring service.
- Measure final gzip/brotli bundle size and verify that minification does not break the custom Webpack/Terser setup.
- Add a CI assertion that production output contains no publicly deployed `.map` files and that JS assets are minified.

### DEPLOY-29-02 — Global CORS origin value contains a trailing slash

**Severity: Medium (cross-origin integration correctness; not an authorization boundary).**

**Observed:**
- `taxi/vercel.json` adds CORS headers to every path `/(.*)`.
- It sets `Access-Control-Allow-Credentials: true`.
- It sets `Access-Control-Allow-Origin: https://chat.itest24.com/` including a trailing slash.
- It sets a broad method list: GET, OPTIONS, PATCH, DELETE, POST and PUT.
- The same JSON content exists in `taxi/src/vercel.json` and `taxi/public/vercel.json` and `taxi/scripts/vercel.json`.

**Impact:**
- A browser serializes an origin as scheme + host + optional port, without a path or trailing slash. The configured value with a slash is not the normal serialized origin `https://chat.itest24.com`; credentialed CORS requests from that origin are therefore likely to fail the allow-origin comparison.
- The header is attached to all static content, even though a static frontend normally does not need credentialed cross-origin access for its own assets.
- CORS controls whether browser JavaScript can read cross-origin responses. It does not replace authentication, authorization or server-side access control.

**Recommendation:**
- Confirm whether the frontend must be embedded or fetched cross-origin from `chat.itest24.com`. If not, remove the global CORS headers.
- If required, use the exact origin without a trailing slash and restrict CORS to the specific paths and methods actually needed.
- Retain `Access-Control-Allow-Credentials: true` only if cookie-based credentialed requests are intentionally required. Never combine credentialed CORS with wildcard origin.
- Test preflight and actual credentialed requests in a real browser against the deployed host.

### DEPLOY-29-03 — Security response headers are not declared in the repository Vercel config

**Severity: Medium (defense-in-depth; production status unverified).**

**Observed:** the reviewed `vercel.json` declares CORS and cache headers only. It does not declare:
- Content-Security-Policy
- Strict-Transport-Security
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- frame-embedding restrictions via CSP `frame-ancestors` or X-Frame-Options

**Impact:** without these controls at the effective hosting layer, the browser has fewer protections against script injection, content-type sniffing, clickjacking, referrer leakage and insecure transport downgrade. A CSP must be designed around the application's real inline styles/scripts, map libraries, API endpoints, WebSockets and authentication providers; an overly strict policy can break the application.

**Recommendation:**
- Inspect effective response headers on the production domain and all preview domains.
- Add an initial report-only CSP, collect violations, then enforce a tested policy.
- Add HSTS only after confirming all relevant subdomains are HTTPS-ready; consider `includeSubDomains` and preload only after a domain-wide review.
- Add `X-Content-Type-Options: nosniff`, a suitable `Referrer-Policy`, `Permissions-Policy`, and a framing policy appropriate to the product.
- Keep this finding marked as “configuration gap in repository” until live response headers are checked.

### DEPLOY-29-04 — Duplicate Vercel configuration is copied into the public build output

**Severity: Low (configuration hygiene and unnecessary public artifact).**

**Observed:**
- Identical `vercel.json` files exist at `taxi/vercel.json`, `taxi/src/vercel.json`, `taxi/public/vercel.json` and `taxi/scripts/vercel.json`.
- `taxi/scripts/build.js` calls `copyPublicFolder()` before compiling. That function copies the contents of `taxi/public` into the build output, excluding only `index.html`.
- Therefore `taxi/public/vercel.json` is copied into the generated static output unless another deployment step removes it.

**Impact:** the deployment configuration is likely downloadable as `/vercel.json`. It contains no secrets in the inspected version, but publishing hosting configuration is unnecessary and multiple copies create ambiguity about which file is authoritative.

**Recommendation:**
- Keep only the Vercel config at the actual project root used by the Vercel project.
- Remove `vercel.json` from `public`, `src` and `scripts` unless there is a specific documented consumer.
- Add a build-output check that rejects deployment/configuration files and local environment files in the public artifact.

### DEPLOY-29-05 — Service-worker cleanup is intentionally aggressive

**Severity: Medium (availability/cache isolation; conditional on registration and shared origin).**

**Observed:**
- `taxi/src/index.tsx` imports `./serviceWorker` and calls `serviceWorker.unregister()` after rendering.
- The service-worker module documents that registration is optional and not called by default.
- `taxi/public/service-worker.js`, if activated, deletes every Cache Storage cache returned by `caches.keys()`, unregisters itself and navigates all controlled window clients.
- `taxi/src/appCache.ts` separately deletes only caches with application-specific prefixes such as `app-shell-`, `runtime-api-`, `map-tiles-`, `workbox-` and `webpack-`; it does not intentionally clear every origin cache.

**Impact:**
- The normal application entry point attempts to unregister a service worker, which should prevent continued service-worker control after successful unregistration but does not synchronously prove that no old worker can control the current page during startup.
- If the public custom worker is activated, it deletes all Cache Storage entries for the origin, not only Taxi-owned caches. This can disrupt other applications hosted on the same origin.
- The worker navigates all its controlled clients after activation, potentially causing reload loops or user disruption if activation/unregistration behavior is not tested.

**Recommendation:**
- Decide whether a service worker is supported at all. If not, keep one clear unregister/legacy cleanup path and remove unused worker artifacts from the public directory.
- If a worker is retained, namespace all cache names and delete only Taxi-owned caches.
- Test upgrades from previously installed worker versions, multiple tabs and another app sharing the same origin.
- Confirm whether `/service-worker.js` is actually served by the production host and whether any deployed client is controlled by it.

### DEPLOY-29-06 — Early analytics guard monkey-patches browser primitives

**Severity: Medium (stability/maintainability; not a security control).**

**Observed:**
- `taxi/public/index.html` loads `external-analytics-guard.js` synchronously in the document head.
- The script replaces `window.fetch`, `navigator.sendBeacon`, `XMLHttpRequest.prototype.open/send`, `Element.prototype.setAttribute`, `Node.prototype.appendChild/insertBefore`, and installs a `MutationObserver`.
- It blocks only two hard-coded URL patterns associated with `gtmpx.com/ga` and query parameter `xtId=..._yabrowser-`.
- Most interception logic is wrapped in empty `catch` blocks, so installation failures are silent.

**Impact:**
- Global monkey-patching can interfere with unrelated libraries, analytics, map SDKs, browser extensions or future application code.
- The blocked URL matching is string/pattern-based and is not a general network policy. Other URL encodings, redirects, alternate hosts or transport mechanisms are not covered.
- Because the script runs before the application bundle, its effects apply broadly to the page.

**Recommendation:**
- Identify the actual third-party behavior being mitigated and remove the root cause where possible.
- Prefer a tested Content-Security-Policy or explicit network allowlist for enforceable resource restrictions.
- If the guard remains, isolate it behind a documented feature flag, test all supported browsers/transports and add telemetry for failed installation rather than silently swallowing every failure.
- Do not treat the guard as a substitute for CSP, CORS or backend authorization.

### DEPLOY-29-07 — Public cache policy is differentiated, but sensitive paths need review

**Severity: Low/Medium (depends on contents of public paths).**

**Observed:**
- Root and `/index.html` are configured `no-cache, no-store, max-age=0, must-revalidate`.
- `/service-worker.js` is also `no-cache, no-store`.
- `/static/(.*)` receives `public, max-age=31536000, immutable`.
- `/assets/(.*)` and `/mock/(.*)` receive one-day public caching with stale-while-revalidate.
- Favicon paths receive one-week public caching.
- Manifest receives `no-cache, max-age=0, must-revalidate`.

**Impact:**
- Long-lived immutable caching is appropriate for content-hashed assets, but the configuration matches all files below `/static/`, not just content-hashed files. If a mutable file is ever placed there, clients may retain stale content for a year.
- Public caching of `/mock/` is safe only if that directory contains non-sensitive static fixtures. If it ever contains tenant-specific or private data, shared caches could serve it beyond the intended context.
- The build's exact asset path and the deployed response headers were not inspected.

**Recommendation:**
- Scope immutable caching to hashed asset paths/names and verify every file under `/static/` is content-addressed.
- Confirm `/mock/` contains only non-sensitive fixtures; do not publish credentials, personal data or production snapshots there.
- Add a build artifact scan for mock/test fixtures and secret patterns.
- Verify effective cache headers with production GET/HEAD requests and CDN behavior.

## Positive observations

- The deployment build command disables source maps.
- The SPA entry point explicitly unregisters the service worker.
- HTML and service-worker script paths are configured not to be cached.
- Static asset caching is separated from the HTML shell.
- The app startup cleanup uses application-specific cache prefixes rather than deleting every named cache.

## Recommended remediation order

1. Remove the production `WEBPACK_SKIP_MINIFY=true` override and measure optimized output.
2. Correct or remove the global credentialed CORS policy; test it in a browser.
3. Inspect production response headers and implement a tested CSP/security-header policy.
4. Remove duplicate `vercel.json` copies, especially the public copy.
5. Simplify service-worker handling and ensure cache deletion is app-scoped.
6. Review `/mock/` and all public assets for sensitive data; tighten cache matching to content-hashed assets.
7. Replace or formally document the analytics guard and test its monkey patches against all supported browser flows.

## Verification checklist

- [ ] Build production output with minification enabled.
- [ ] Confirm no public `.map`, `.env`, `vercel.json` or test fixture files are present.
- [ ] Inspect production and preview HTTP response headers.
- [ ] Test preflight and credentialed CORS from the exact intended origin.
- [ ] Test CSP in report-only mode, then enforce after resolving violations.
- [ ] Verify all `/static/` files have immutable content hashes.
- [ ] Verify `/mock/` contains no user/tenant/private data.
- [ ] Test service-worker upgrade/unregister with old clients and multiple tabs.
- [ ] Test the analytics guard against fetch, XHR, sendBeacon, script/style/link insertion and map/chat/auth integrations.

## Limitations

- No deployed URL was supplied or queried; Vercel dashboard configuration, custom domains, CDN overrides, preview deployment settings and actual response headers remain unverified.
- The report does not claim that missing security headers in `vercel.json` are necessarily missing from effective production responses.
- The service-worker impact is conditional on the worker being served/registered/controlling a client.
- No production build or browser regression suite was run in this stage.
- No application source or deployment configuration was modified.
