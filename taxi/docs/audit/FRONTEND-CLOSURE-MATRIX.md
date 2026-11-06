# Frontend audit — consolidated closure matrix

## Baseline

- Application source baseline: `main@8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.
- Audit documentation branch: `audit/frontend-inventory`.
- Scope: frontend only; documentation stages 01–50. Backend authorization, tenant write permissions, deployed configuration and cross-layer behavior remain separate evidence tracks.
- No application source has been changed by the audit branch. Documentation of a finding is not remediation.

**Status:** OPEN — P1 = pilot-critical; OPEN — P2 = hardening; EVIDENCE GAP = required execution/production proof missing; DEFERRED = backend/integration track; DOCUMENTED = source trace recorded, not fixed.

## A. Security and browser trust boundaries

| Stage | Finding | Required closure evidence | Status |
|---|---|---|---|
| 01–10 | Foundational inventory, API register, Passenger/Driver forms and flows, Redux/Saga ownership, Platform Interface/FSM adapters, runtime/build integrations, test/pilot gates and 68-entry QA registry reconciliation. These are baseline mapping stages, not individual defect-free certifications. | Reconcile each inventory claim against the pinned source baseline; complete the pending driver-form, runtime, test and QA evidence listed in the stage reports. | DOCUMENTED; residual evidence gaps remain |
| Stage | Finding | Required closure evidence | Status |
|---|---|---|---|
| 26 | Token persistence, public build variables, auth logging, WebSocket token transport and route guards reviewed. | Remove/redact credential logs; inspect emitted bundle and actual WebSocket requests; prove server authorization and route guards. | OPEN P1/P2; backend/deployment evidence deferred |
| 27 | Upload validation/limits and Sandbox import boundaries incomplete; backend storage ACLs unknown. | Enforce client limits and safe previews; server-side content validation, private-file ACL and download tests; bounded imports. | OPEN P1/P2; ACLs deferred |
| 28 | Lockfile contains packages in published advisory ranges; reachability not fully established. | Upgrade/pin safe versions, regenerate lockfile, run current dependency audit and build/tests. | OPEN P1/P2 |
| 29–30 | Production headers/CORS/cache/minification and public artifacts/emulator/CI traces need deployment verification; tracked emulator material identified. | Rotate exposed credentials; inspect public artifacts/traces; verify headers, bundle, source maps and production exclusion of test controls. | OPEN P1 + EVIDENCE GAP |
| 44 | API-returned pricing formula reaches browser `eval()`. | Remove `eval`; use constrained arithmetic parser; reject hostile syntax; test all consumers. | OPEN P1 |
| 45 | Startup tenant selector loads remote executable JS; tenant schema/translations reach `dangerouslySetInnerHTML`; Sandbox parses imported HTML. | Replace with validated JSON or strict allowlist; text-only/sanitized labels; remove/protect Sandbox; hostile-input tests. | OPEN P1/P2 |
| 46 | Tenant support value reaches `window.open(..., '_blank')` without scheme allowlist or explicit opener isolation. | Typed URL/email; allow only required schemes/origins; `noopener,noreferrer`; hostile URL and opener tests; verify tenant permissions. | OPEN P2, conditional on config trust |
| 47 | Double-decoding query values can throw in startup Saga tree and cancel sibling watchers. | Remove redundant decode; isolate URL parsing; malformed-input and root-Saga resilience tests. | OPEN P1 pending runtime regression |
| 48 | URL/localStorage emulator flag disables strict Driver empty-order gate and enables backend polling. | Exclude from production or require scoped server capability; clear on account/tenant switch; inspect production bundle and run backend negative tests. | OPEN P1 if production-reachable; otherwise P2 |
| 49 | Debug exports serialize raw `href` and `search`; query credentials are not redacted inside strings. | Redact/remove query values; clear OAuth callback credential from history; sentinel-secret tests for interface/flow/all exports. | OPEN P2, conditional on export/share |

## B. Functional behavior and state consistency

| Stages | Consolidated findings | Required closure evidence | Status |
|---|---|---|---|
| 11–20 | Passenger action/Legacy contract gaps; separate Chat WebSocket; SOS semantics; rating payload/error/readback gaps; candidate fallback and order-history/recovery inconsistencies. | Versioned action contract; positive/negative/retry tests for every mutation; rating persistence/readback; candidate and reload recovery tests. | DOCUMENTED; OPEN test/contract gates |
| 21–23, 39 | Session teardown and persisted personal state; stale order projections; incomplete cross-role and same-browser account-isolation proof. | Two-account same-browser tests; logout/login teardown; reload/reconnect and two-context Passenger↔Driver synchronization tests. | OPEN P1 |
| 24–25, 35–38 | Terminal action inconsistency, suppressed/unhandled errors, business-error envelope mismatch, polling stalls and ambiguous timeout/retry behavior. | Idempotent command contract; stable command IDs; bounded requests; error/readback/reconciliation; concurrent terminal-command tests. | OPEN P1; backend contract deferred |
| 32 | Boarding PIN frontend shape checks do not prove identity; prior live evidence reports incorrect PIN acceptance; Offer classification inconsistent. | Backend negative/replay/cross-order PIN tests; canonical Offer field and tenant-backed regression. | DEFERRED backend/integration; P0 pilot blocker |
| 33 | Currency defaults and fare fallback/flag issues; settlement/quote authority unknown. | Correct frontend calculations; MAD units/rounding contract; tenant values and server quote/settlement verification. | OPEN frontend + DEFERRED backend; P0 pilot gate |
| 34, 36 | Standard/Voting/Offer transport ownership differs; direct API mutation paths bypass gateway. | Per-operation Legacy/FSM matrix; supported pilot scope; mutation and transition contract tests. | DOCUMENTED; integration deferred |
| 37 | UI can navigate/close as if successful before backend action is confirmed. | Failure/retry/reconciliation tests for each affected action. | OPEN P1/P2 |
| 40 | Primary/driven car mismatch, car-cache and capacity reconciliation gaps. | Multi-car, malformed-capacity and profile reconciliation tests. | OPEN P2 |
| 41–42 | GPS stale-fix reuse; no ordinary non-emulator Driver publisher visible; timestamp/accuracy absent from location payload; backend freshness/dispatch unavailable. | Reject stale fixes; physical-device GPS recovery; backend persistence/expiry/identity/dispatch tests. | OPEN frontend + DEFERRED backend |
| 43 | Test coverage inventory reconciled; test existence is not execution. | Execute identified tests and add missing polling/session/GPS coverage. | DOCUMENTED; EVIDENCE GAP |

## C. Test and deployment evidence

| Gate | Current evidence | Closure requirement | Status |
|---|---|---|---|
| 31 | Revalidated pinned source baseline and inspected historical Playwright run #178 (19 passed, two flaky retries); current Jest, TypeScript and build were not executed because a clean checkout was unavailable. | Obtain a clean checkout and run all three against one exact SHA; retain raw logs, versions and exit codes. | EVIDENCE GAP |
| Jest/unit | Historical results exist; current baseline rerun was blocked by checkout/network. | Fresh run tied to exact SHA, environment versions, raw logs and exit code. | EVIDENCE GAP |
| TypeScript/build | Current baseline rerun not executed. | Fresh typecheck and production build; inspect emitted bundle and public assets. | EVIDENCE GAP |
| Playwright | Historical run #175: 21 passed; run #178: 19 passed with two flaky retries. | No-retry stability run, full artifact/trace review and explicit frontend/backend/tenant versions. | EVIDENCE GAP; flaky cases open |
| Stages 44–50 tests | No tests executed during these source-review stages. | Hostile formula/config/HTML/support URL/query/Saga/emulator/export-redaction tests. | OPEN |
| Morocco pilot acceptance | No production tenant, physical-device or effective-header verification in this track. | Deployment manifest; MAD tariff and PETIT/GRAND rules; device/network/GPS checks; rollback proof. | DEFERRED deployment/integration |

## D. Documentation completeness

| Stage | Result | Limitation |
|---|---|---|
| 50 | All 49 prior numbered report files (01–49) and their README references were verified in the audit folder; README ordering and closure-matrix coverage gaps were reconciled. | This verifies documentation integrity only. It is not a fresh source audit, test run, security validation or deployment check. |

## D. Closure decision

The frontend audit is **not closed**. Stages 1–50 are documentation/source-review stages, not 50 successful test stages.

1. **P0 pilot blockers:** stage 32 boarding-code authority and Offer classification; stage 33 canonical pricing/currency; production credential/test-control gating from stages 26/30/48; real tenant and device acceptance.
2. **P1 frontend gates:** stage 44 `eval`; stage 45 executable tenant config/HTML sinks; stage 47 startup Saga cancellation; relevant upload/public-surface findings; account isolation and terminal lifecycle/error recovery.
3. **P2 hardening:** stage 46 support URL validation/opener isolation; stage 49 diagnostic query redaction; dependency/delivery hardening; phone-number normalization.
4. **Evidence gates:** fresh Jest, TypeScript, build and stable Playwright; regression tests for stages 44–49; production header/bundle and physical-device checks.
5. **Deferred tracks:** backend authorization, auth-hash expiry/replay, tenant publishing permissions, location persistence/expiry, fare settlement, lifecycle idempotency and cross-role integration are not closed by frontend source review.

**Closure rule:** close a frontend finding only when a named code commit contains the remediation and the required regression test passes. Track backend and integration dependencies separately. Frontend UI behavior is not proof of server authorization or state correctness. Stage 50 closes only documentation consistency. This matrix is not a pilot go/no-go approval.
