# Frontend audit continuation and closure plan

## Purpose

This document reconstructs the continuation plan after audit stages 1–30. It is based on the saved inventory, stage reports 01–30, the QA registry reconciliation, and the explicit next actions and pilot gates in stage 09. It is a plan for completing evidence and acceptance work, not a claim that the application is ready for pilot.

## Audit baseline and rules

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Documentation branch: `audit/frontend-inventory`
- Exclude `review/10-qa-review` and the unavailable local QA worktree from source conclusions.
- Keep source observations, documented claims, executed tests, and unverified deployment/backend claims separate.
- Do not modify application code on the audit branch. Record findings and evidence only. Remediation belongs in separately approved implementation branches/PRs.
- Do not create a PR for the audit package until the audit and closure evidence are complete and explicitly approved.

## What is already covered

Stages 01–10 established the source inventory, API register, forms, driver actions, page flows, Redux/Saga ownership, Platform Interface/FSM boundaries, runtime/build integrations, test/pilot gates, and reconciliation of the 68-entry QA registry.

Stages 11–25 deepened reachability and lifecycle tracing: passenger action dispatch, chat/SOS/rating, passenger mutations and candidate fallback, local order state, passenger order lifecycle/history, reload/auth/account isolation, driver reload/map recovery, cross-role synchronization, terminal transitions/concurrency, and API failure/timeout recovery.

Stages 26–30 covered frontend security/secrets, uploads/user content, dependency supply chain, production/browser delivery, and public repository/emulator/CI artifact exposure.

The initial inventory counted 626 source files, 51 source test files and 12 Playwright E2E specifications. Those are inventory counts, not coverage claims.

## Remaining work, in execution order

### Work package A — Re-establish reproducible test evidence

1. Pin and record the exact current `main` SHA before any new execution; verify it against the audit baseline and record any drift.
2. Run Jest/unit tests, TypeScript and the production build against that exact SHA. Retain raw logs, exit codes, environment/runtime versions and artifact hashes.
3. Run the Playwright suite against the explicitly selected test tenant. Record the exact backend tenant/version, frontend SHA, test account set, run ID and whether retries were enabled.
4. Inspect trace/report artifacts for every Playwright project and failure/retry path. Establish what authentication data, personal data, URLs and request/response bodies are retained; verify redaction and retention.
5. Add/identify tests for the gaps already documented: passenger Chat WebSocket, rating payload/error/retry/readback, waiting-time and price business errors, candidate fallback consistency, passenger completion, simultaneous terminal commands, two-context Passenger↔Driver synchronization, and reload/account-switch recovery.
6. Do not treat a retry-passing scenario as stable. Run a controlled no-retry stability pass after deterministic test isolation is established.

**Exit evidence:** one immutable test report tied to an exact frontend SHA and backend tenant; raw Jest, TypeScript, build and E2E results; artifact confidentiality review; explicit list of untested scenarios.

### Work package B — Resolve frontend/backend contract gates

1. Boarding PIN: verify server-side validation of a well-formed incorrect code, binding to the correct order/driver/passenger, replay behavior, attempt limits and audit logging. Frontend digit-shape validation is not identity verification.
2. Offer classification: agree the canonical server field/contract; resolve the observed `b_cars_count=0` readback as `"1"` behavior on tenant `gruzvill`; add a real-tenant regression test. Do not rely on a frontend heuristic over an unverified field.
3. Pricing: document canonical amount units, currency (MAD for Morocco), rounding, price authority, quote expiry, customer override semantics and server-side validation. Verify ETA authority and fallback behavior.
4. Order lifecycle: document authoritative states and legal transitions for Standard, Voting and Offer; verify cancellation/finish idempotency, concurrent command handling, terminal-state readback and recovery after ambiguous timeouts.
5. Passenger/Driver transport boundary: list each mutation still routed through Legacy versus FSM, define the accepted pilot scope, and verify that UI feature flags do not imply a transport migration that has not occurred.
6. Confirm backend error envelopes and HTTP-200 business-error behavior for the methods flagged in stages 16, 18, 20, 24 and 25.

**Exit evidence:** versioned API/state contract, backend owner decisions, tenant-backed positive and negative tests, and a per-operation Legacy/FSM matrix. Any unresolved server-side identity, pricing or terminal-state contract remains a pilot blocker.

### Work package C — Close security, privacy and public-surface findings

1. Revoke/rotate credentials committed in emulator configuration and browser emulator code. Do not reproduce secret values in reports or logs.
2. Verify that emulator and diagnostic controls are absent or strongly gated in production and cannot mutate real accounts/orders through a public UI.
3. Remove or neutralize hard-coded/browser-exposed privileged tokens; inspect the emitted production bundle and actual runtime requests. Treat every `REACT_APP_*` value as public.
4. Inspect all retained CI traces/artifacts, especially failure and retry artifacts, for tokens, cookies, account identifiers and personal data. Define redaction and least-retention policy.
5. Verify upload size/count/type enforcement, server-side MIME/content validation, private-file authorization and download ACLs. Review Base64 and Sandbox import limits.
6. Review the JSON-form HTML sink and all external configuration/script trust boundaries; verify CSP and other response headers on the deployed host/CDN.
7. Verify public build contents, source maps, public test reports, emulator files, map datasets and environment-file exclusion. Rotate any exposed credentials even if current validity is unknown.
8. Review analytics/network monkey-patching for compatibility and unintended side effects; verify actual requests rather than treating the guard as a security boundary.

**Exit evidence:** secret-rotation record, production bundle/public-URL inspection, CI artifact review, upload/ACL tests, deployed header report and privacy-safe telemetry evidence.

### Work package D — Verify deployment and Morocco pilot configuration

1. Obtain the actual pilot URL and identify the deployed frontend SHA, backend/PHP version, FSM version, tenant, configuration/dictionary version and deployment timestamp.
2. Inspect effective response headers, CORS, caching, CSP, HSTS, frame/MIME/referrer/permissions policies, source maps and service-worker behavior at the deployed URL.
3. Verify environment parity and rollback compatibility between frontend, backend, FSM and dictionaries. A successful frontend build or Vercel check alone is insufficient.
4. On the intended Moroccan pilot tenant, verify MAD currency, tariff units and rounding, PETIT/GRAND license rules, city/zone boundaries, allowed pickup/drop-off combinations, vehicle classes and local configuration.
5. Measure mobile cold-start and map behavior using the actual shipped assets and representative network conditions; confirm whether the large Agadir graph/XML assets are needed and how multi-city coverage is configured.
6. Exercise supported browsers and physical Android/iOS devices, including permission denial, GPS loss/recovery, background/resume, orientation and poor connectivity.

**Exit evidence:** deployment manifest, effective-header and bundle inspection, rollback proof, tenant configuration sign-off, and device/network test results.

### Work package E — Final pilot acceptance and audit closure

1. Execute full end-to-end journeys initiated through the passenger UI for Standard, Voting and Offer, through driver visibility/acceptance, pickup/boarding, trip progression, cancellation/finish and passenger feedback/history where supported.
2. Repeat critical journeys with two independent sessions/devices to verify cross-role synchronization and account isolation.
3. Verify reload/re-login/reconnect at each meaningful lifecycle stage and prove that stale local state cannot select another account's order or driver.
4. Run negative cases: incorrect boarding PIN, unauthorized actions, duplicate/concurrent commands, backend timeout after command acceptance, unavailable GPS, invalid coordinates, failed upload, expired auth and stale tenant configuration.
5. Record each QA registry item as verified closed, partially closed, open backend contract, open deployment/acceptance, or accepted technical debt. Link every closure to code SHA, test case and execution evidence.
6. Publish a concise pilot-readiness decision with blockers, residual risks, operating procedures, monitoring/rollback and named acceptance owners.

**Exit evidence:** signed acceptance matrix for all three order modes, exact tested versions, reproducible test results, residual-risk register and explicit go/no-go decision.

## Priority order

- **P0 — Before any real pilot:** credential rotation and emulator production gating; server-side boarding PIN validation; authoritative Offer classification; canonical price/currency contract; deployed token/authorization review; real tenant and device acceptance.
- **P1 — Before broad rollout:** terminal command idempotency/concurrency, cross-role synchronization, account isolation/reload recovery, upload ACLs, CI artifact confidentiality, deployment headers and rollback.
- **P2 — Quality and scale:** remaining Chat/Rating/waiting/price coverage, map asset optimization, analytics guard cleanup, multi-city configuration and non-functional/load testing.

## First concrete action

Start with Work package A, item 1: resolve the exact current `main` SHA and compare it to the pinned audit baseline. If it has moved, do not silently mix evidence; either audit the pinned baseline first or create a separately identified delta review for the new SHA. Then execute Jest, TypeScript and production build against the declared SHA before proceeding to tenant-dependent checks.

## Explicit limitations

This plan does not claim access to the production deployment, private backend implementation, tenant configuration, physical devices or all retained CI artifact contents. Those require explicit evidence and access. No overall pilot approval is implied by completion of source stages 01–30.
