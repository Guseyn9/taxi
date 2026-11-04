- Stage 23: traced Passenger and Driver collection polling, per-order detail subscriptions, separate full/partial Redux order projections, mutation completion and Driver Map reconciliation. Identified the emulator-dependent driver watcher gate, possible stale detail precedence, a detail watcher that can stall after a skipped read plus failed mutation, and missing two-context cross-role E2E proof. No application source changed.
# Frontend audit

## Scope and working rules

- Repository: `Guseyn9/taxi`
- Baseline branch: `main`
- Baseline commit: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit working branch: `audit/frontend-inventory`
- The local QA version described in the 2026-11-03 QA report is treated as unavailable/nonexistent for source comparison; no QA commit or patch was supplied.
- Experimental branch `review/10-qa-review` is excluded from the evidence base.
- No application source files are changed by this audit branch.
- Intermediate findings are committed here as documentation only.
- No pull request is created until the audit package is complete and explicitly approved.

## Continuation after stage 30

The recovered closure plan is maintained in [CONTINUATION-PLAN.md](./CONTINUATION-PLAN.md). It sequences remaining test evidence, backend/API contracts, security and artifact review, deployment/Morocco configuration, and final pilot acceptance. Stage 30 is not an overall pilot approval.

## Audit sequence

1. Frontend inventory and coverage map.
2. API method and endpoint inventory; trace callers, payloads, responses, failures and tests.
3. Passenger and driver forms, validation and order actions.
4. Page-level flows, lifecycle gates and modal behavior.
5. Redux, Saga, Thunk and state ownership.
6. Platform Interface, FSM transports and legacy adapters.
7. Runtime configuration, build and external integrations.
8. Test execution, coverage reconciliation and pilot-readiness gates.
9. QA defect registry reconciliation (68 findings).
10. API call-site reachability and lifecycle transport branching.

## Evidence rules

Each finding must distinguish:
- **Observed in source** — directly verified in the selected commit.
- **Documented** — stated in repository documentation but not independently verified.
- **Tested** — covered by an identified test file/scenario; test execution status is recorded separately.
- **Unverified** — requires runtime, backend, deployment or production evidence.

File counts are inventory metrics, not quality or test-coverage metrics. Presence of an adapter or test does not prove production configuration or successful integration.

## Progress

| Stage | Status | Artifact |
|---|---|---|
| 1. Structure inventory | Initial pass complete; detailed tracing pending | [01-frontend-inventory.md](./01-frontend-inventory.md) |
| 2. API register and request-path audit | Source pass complete; test/caller mapping continues | [02-api-register.md](./02-api-register.md) |
| 3. Forms and validation | Source pass complete; driver-side forms remain | [03-forms-and-validation.md](./03-forms-and-validation.md) |
| 4. Driver forms and actions | Source pass complete; backend/config verification remains | [04-driver-forms-and-actions.md](./04-driver-forms-and-actions.md) |
| 5. Page-level flows and action gates | Source pass complete; runtime/test verification remains | [05-page-flows-and-action-gates.md](./05-page-flows-and-action-gates.md) |
| 6. Redux, Saga and state ownership | Source pass complete; regression tests/runtime verification remain | [06-redux-saga-state-ownership.md](./06-redux-saga-state-ownership.md) |
| 7. Platform Interface, FSM and legacy adapters | Source pass complete; deployment/configuration verification remains | [07-platform-interface-fsm-legacy.md](./07-platform-interface-fsm-legacy.md) |
| 8. Runtime configuration, build and external integrations | Source pass complete; Vercel settings, live credentials and deployed bundle remain unverified | [08-runtime-build-integrations.md](./08-runtime-build-integrations.md) |
| 9. Test execution, coverage and pilot gates | E2E CI 21/21 verified; artifact inspected; Jest/TypeScript rerun blocked by network; operational gates remain | [09-test-execution-and-pilot-gates.md](./09-test-execution-and-pilot-gates.md) |
| 10. QA registry reconciliation | All 68 registry entries cross-referenced; QA closure claims separated from main evidence; local QA patch unavailable | [10-qa-registry-reconciliation.md](./10-qa-registry-reconciliation.md) |
| 11. API reachability and FSM branching | Voting/boarding stub reachability traced; notifyPosition call site not found; trip method reachability clarified | [11-api-reachability-and-fsm-branching.md](./11-api-reachability-and-fsm-branching.md) |
| 12. Passenger Action Contract and call paths | Seven legacy passenger mutations traced; five declared actions lack handlers in LegacyPassengerGateway; rating bypasses Passenger Action path | [12-passenger-action-contract-and-callpaths.md](./12-passenger-action-contract-and-callpaths.md) |
| 13. Passenger Surface and feature flags | Clarified actions are UI metadata, not proof of dispatch; Passenger UI FSM flag changes presentation, not command transport; snapshot source and command path are separate | [13-passenger-surface-actions-and-feature-flags.md](./13-passenger-surface-actions-and-feature-flags.md) |
| 14. Passenger Chat, SOS and Rating | Chat uses separate WebSocket; SOS maps to cancel-with-reason, not incident dispatch; rating drops tips/comment and closes before API result | [14-passenger-chat-sos-rating.md](./14-passenger-chat-sos-rating.md) |
| 15. Passenger Chat, SOS and Rating test coverage | SOS has meaningful UI/backend E2E; Chat WebSocket and Rating payload/error paths lack comparable E2E coverage | [15-passenger-chat-sos-rating-test-coverage.md](./15-passenger-chat-sos-rating-test-coverage.md) |
| 16. Passenger mutations and test coverage | Full cancellation and candidate happy paths traced; local-choice fallback, release state contract, waiting/price test gaps documented | [16-passenger-mutations-and-test-coverage.md](./16-passenger-mutations-and-test-coverage.md) |
| 17. Passenger candidate fallback consistency | Local fallback can mark Considering candidate selected; VotingForm and PassengerLiveOrder resolve selected driver differently; localStorage lifecycle and test gaps reviewed | [17-passenger-choice-fallback-consistency.md](./17-passenger-choice-fallback-consistency.md) |
| 18. Passenger order local state lifecycle | Rejected IDs and ETA lack per-order cleanup; MiniOrders trusts local choice; waiting wrapper may accept HTTP-200 business errors; price override is transient UI state | [18-passenger-order-local-state-lifecycle.md](./18-passenger-order-local-state-lifecycle.md) |
| 19. Passenger order lifecycle end-to-end | Traced form → POST /drive → CREATE_SUCCESS → active-list refresh → selected-order resolution → Finished/rating and removed-order recovery; identified Voting confirmation, pending visibility, selected-order recovery and rating idempotency risks | [19-passenger-order-lifecycle-end-to-end.md](./19-passenger-order-lifecycle-end-to-end.md) |
| 20. Passenger history and rating submission | Archive API/Redux exists but UI consumer is driver-only; passenger history surface not found; rating sends stars only, closes before response and lacks durable submission/readback tests | [20-passenger-history-and-rating-submission.md](./20-passenger-history-and-rating-submission.md) |
| 21. Passenger reload, auth and account isolation | Traced bootstrap cleanup, auth hydration, persisted form fields, logout/login and selected-order/rating recovery; found cross-account phone persistence and conditional Redux cleanup on logout | [21-passenger-reload-auth-and-account-isolation.md](./21-passenger-reload-auth-and-account-isolation.md) |
| 22. Driver reload, auth and map recovery | Traced driver watchers, volatile Redux order cache, map module cache, GPS watch/send and emulator boot behavior; found map continuity is remount-only and account cleanup remains conditional | [22-driver-reload-auth-and-map-recovery.md](./22-driver-reload-auth-and-map-recovery.md) |
| 23. Cross-role order-state synchronization | Traced passenger/driver collection polling, per-order detail watchers, split full/partial Redux projections, map reconciliation and mutation failure paths; identified conditional driver watcher gate, stale detail precedence and a detail-watcher stall case | [23-cross-role-order-state-synchronization.md](./23-cross-role-order-state-synchronization.md) |
| 24. Terminal order transitions and concurrent actions | Reviewed Passenger/Driver cancel and finish paths, component-level locks, response validation and E2E; found fire-and-forget driver cancellation, unguarded OnTheWay finish, inconsistent Passenger finish paths and missing concurrent-command tests | [24-order-terminal-transitions-and-concurrent-actions.md](./24-order-terminal-transitions-and-concurrent-actions.md) |
| 25. API failures, timeouts and recovery | Reviewed legacy API transport, FSM Command POST/status polling, Redux polling recovery and E2E retry policy; found no visible legacy request deadline, new command ID on each retry, unbounded initial FSM POST and ambiguous completion timeout | [25-api-failures-timeouts-and-recovery.md](./25-api-failures-timeouts-and-recovery.md) |
| 26. Frontend security, authentication and secrets | Reviewed token storage, REACT_APP_* exposure, FSM HTTP/WebSocket credentials, auth logging, route-role guards and JSON-form HTML sink; backend authorization and deployed secrets remain unverified | [26-frontend-security-auth-and-secrets.md](./26-frontend-security-auth-and-secrets.md) |
| 27. File upload and user content security | Traced registration/profile/avatar uploads, Base64 transport, MIME validation, file IDs, public/private flag, blob previews and Sandbox JSON import; backend storage validation/ACLs remain unverified, no frontend ZIP extraction found | [27-file-upload-and-user-content-security.md](./27-file-upload-and-user-content-security.md) |
| 28. Dependencies and software supply chain | Audited npm lockfile (2,124 entries), confirmed advisory-range matches for webpack-dev-server, PostCSS, minimatch, loader-utils, cross-spawn, Axios and micromatch; reviewed local fork provenance, install scripts, package_fixed.json and license metadata. Reachability and live npm audit remain unverified | [28-dependencies-and-supply-chain.md](./28-dependencies-and-supply-chain.md) |
| 29. Production deployment and browser delivery | Reviewed Vercel header/cache policy, CORS origin formatting, disabled production minification, public config copies, service-worker cleanup and early analytics monkey-patching. Effective production headers and deployed runtime remain unverified | [29-production-deployment-and-browser-delivery.md](./29-production-deployment-and-browser-delivery.md) |
| 31. Baseline revalidation and executable test evidence | Main SHA reconfirmed; run #178 inspected (19 passed, 2 flaky); Jest/TypeScript/build not executed due unavailable checkout/network | [31-baseline-revalidation-and-test-evidence.md](./31-baseline-revalidation-and-test-evidence.md) |
| 32. Boarding-code authority and Offer classification | Confirmed shape-only frontend fallback, synthetic legacy confirmation stub, recorded live-backend acceptance of incorrect boarding codes, and fragile Offer marker normalization; identified duplicated E2E classification oracle | [32-boarding-code-and-offer-contracts.md](./32-boarding-code-and-offer-contracts.md) |
| 33. Pricing, currency and fare calculation | Found RUB defaults requiring verified MAD tenant config, incorrect per-kilometer fallback, feature-flag inconsistency for Offer price, and `submit_price` substitution typo; backend settlement/quote expiry remain unverified | [33-pricing-currency-and-fare-contract.md](./33-pricing-currency-and-fare-contract.md) |
| 30. Public repository artifacts, emulator exposure and CI traces | Reviewed tracked emulator credentials and mutating browser controls, Playwright trace retention, public build artifacts, map payloads, frontend token configuration and release metadata. Credential validity, artifact contents beyond inspected run #178, and live production exposure remain unverified | [30-public-repository-artifacts-emulator-and-ci-exposure.md](./30-public-repository-artifacts-emulator-and-ci-exposure.md) |

## Change log

- Stage 31: reconfirmed that main still equals the pinned baseline; inspected raw run #178 logs and confirmed 19 passed with two flaky retries, including a trip-finish cleanup state conflict. Verified that the current workflow runs only Playwright E2E and does not run Jest, TypeScript or production build. Identified exact commands and the pre-build side effect. A clean checkout could not be obtained because the execution container could not resolve github.com; no Jest/TypeScript/build result is claimed.
- Stage 32: traced Voting boarding-code validation through local UI checks, the legacy gateway and the configured FSM command path. Confirmed the legacy confirmation method is a local success stub and the existing live-backend evidence says the measured gruzvill backend accepts an incorrect code; recorded this as a P0 pilot blocker. Reconciled Offer marker loss and conversion behavior, and identified the separate E2E snapshot predicate as a potential test-oracle drift. No application source changed.
- Stage 33: traced tenant currency loading, fare defaults, customer-price display gates, and final-price formula evaluation. Found the RUB default/MAD tenant-config dependency, a wrong fallback constant for per-kilometer fare, an Offer/customer-price flag mismatch, and a `submit_price`/`submit_rice` substitution typo. Backend quote expiry, final settlement and actual Morocco tenant values remain unverified. No application source changed.


- Initial audit documentation created on branch `audit/frontend-inventory`, based on the pinned `main` commit above.
- Added API register, endpoint map and confirmed source-level risks in `02-api-register.md`.
- Deepened route/geocoding review: confirmed browser-visible ORS key, mock-backed area graph dependency, zero-coordinate checks and duplicate route fallback implementations.
- Added passenger form/input validation review, confirmed JSONForm validation inconsistencies, coordinate checks and phone persistence.
- Added driver registration/profile/document-upload and order-action review; flagged offer payload fallback, local-only decline state and partial profile-save risks.
- Added page-level driver/passenger flow review; flagged swallowed map-finish failures, rating submission/feedback gaps and non-global mutation locks.
- Added Redux/Saga state ownership review; flagged full-vs-partial order precedence, duplicate detail/collection stores, persisted draft reset policy, a dormant setStatus action-creator defect and zero-coordinate truthiness.
- Added Platform Interface/FSM review; confirmed passenger mutations remain legacy-backed, single-order provider selection risk, empty-action fallback semantics, independently configured command/completion modes, remaining legacy driver actions and optimistic UI-state concerns.
- Added runtime/build/integration review; flagged browser exposure of REACT_APP_* credentials, a hard-coded ORS token, executable remote tenant configuration, disabled production minification, static-site CORS configuration and public geocoding/routing dependencies.
- Added test execution and pilot-gate review: verified full E2E CI run #175 (21 passed), separated historical Jest/TypeScript results from current-main evidence, inspected the uploaded report artifact, and recorded backend boarding-code and Offer-classification contract gates.
- Reconciled all 68 findings in the 2026-11-03 QA registry. QA-local results, selected-main source/CI evidence and production acceptance remain distinct.
- Treated the local QA worktree as unavailable: no QA SHA/patch exists in the supplied evidence, so no commit-to-commit QA diff is claimed.
- Continued source audit on the pinned main: traced voting/boarding stubs through legacy and FSM branches; downgraded the plain-HTTP notifyPosition issue from confirmed runtime exposure to unproven reachability.

- Traced Passenger Gateway UI call sites and compared the 12 declared Passenger Action types with the seven actions handled by the legacy adapter; documented the conditional missing-terminal-event risk and the direct rating path. Corrected the audit's treatment of DriverTripCancelModal: selected main already routes cancellation through DriverMapGateway.

- Traced PassengerSurface and runtime composition. Refined stage 12: five action types without LegacyPassengerGateway handlers are not shown to be dispatched by the current Passenger UI; availableActions are used as visibility metadata. Confirmed Passenger UI FSM feature flag changes presentation only, while seven mutations still use the legacy Gateway. Snapshot provider selection is independent of mutation transport.

- Traced Passenger chat click-to-WebSocket, SOS modal-to-cancel API, and Rating modal-to-rating API. Confirmed that SOS is cancellation-with-reason rather than a separate incident service, and rating fields tips/comment are not sent while the modal closes before API completion. Identified multiple rating-open triggers for follow-up idempotency tests.

- Stage 15: assessed real test coverage for passenger Chat, SOS and Rating. SOS has the strongest UI-to-live-backend E2E/readback coverage; no comparable Chat WebSocket or Rating payload/retry E2E was found. Historical CI run is distinguished from a new run on the pinned baseline.

- Stage 16: traced passenger full cancellation, candidate selection/release, waiting-time extension and customer-price update from UI through LegacyPassengerGateway to API. Identified local-choice fallback consistency risk, release-after-Performer backend limitation, missing waiting/price/release E2E coverage, and the setWaitingTime HTTP-200 business-error handling gap.

- Stage 17: inspected both passenger candidate-selection handlers, the local confirmed/rejected-choice storage helpers, selected-driver resolution and startup cleanup. Confirmed that fallback can promote a merely Considering candidate into a selected-driver panel in VotingForm, while PassengerLiveOrder requires Performer or later. Documented localStorage scope/lifecycle and missing fallback-state consistency tests.

- Stage 18: reviewed rejected-choice history, pickup ETA cache, waiting-extension state, customer-price optimistic override, MiniOrders selected-driver resolver and startup cleanup. Confirmed missing per-order cleanup for rejected/ETA maps, a second local-choice resolver in MiniOrders, unused waiting-extension storage helpers, and the HTTP-200 business-error handling gap in setWaitingTime. No application source changed.
- Stage 19: traced passenger order creation through form, API, Redux thunk and active-order polling; followed selected-order ownership and driver/order state observation through Finished, active-list disappearance and rating. Identified best-effort Voting confirmation, pending-order visibility timeout gap, selection loss on active-list omission, memory-only rating deduplication and missing integrated passenger-finish E2E. No application source changed.
- Stage 20: traced the /drive/archive history path through API, Saga and Redux and confirmed the selected UI consumer is Driver-only; the passenger adapter/page has no history list/watcher. Traced RatingModal through SetRate and found tips/comment omitted from payload, immediate modal close, no explicit HTTP-200 business-error rejection and no durable submission/readback path. No application source changed.

- Stage 21: traced startup cleanup and auth restoration, client-order localStorage initialization/reset, logout success/failure ordering, login/account-switch behavior, active-order re-fetch and component-local selected/pending/rating state. Found passenger phone persistence across accounts, conditional order-cache cleanup on remote logout success, incomplete client-order/modal reset, and no durable selected/pending-order recovery. No application source changed.
- Stage 22: reviewed driver page watcher gates, normalized order cache, map module-scope demo state, GPS watch/send lifecycle, browser emulator startup behavior, user-scoped offer simulation data and driver list UI state. Confirmed map continuity cache survives remount but not reload; identified mixed emulator persistence and inherited account-boundary cleanup risk. No application source changed.
- Stage 23: traced Passenger and Driver collection polling, per-order detail subscriptions, separate full/partial Redux order projections, mutation completion and Driver Map reconciliation. Identified the emulator-dependent driver watcher gate, possible stale detail precedence, a detail watcher that can stall after a skipped read plus failed mutation, and missing two-context cross-role E2E proof. No application source changed.
- Stage 24: reviewed terminal lifecycle actions and races across Passenger and Driver. Found DriverCancelModal navigates before cancellation resolves, OnTheWayModal has no finish lock, Passenger finish paths use inconsistent local guards/refresh behavior, Driver Map navigates after finish failure, and Passenger completion response validation needs API-contract confirmation. Existing TEST-E2E-010/011 cover single Driver finish/interruption only; no concurrent terminal-command E2E. No application source changed.
- Stage 25: reviewed API transport and recovery. FSM Command status polling has a bounded completion wait and retries transient status lookup failures, but initial POST has no explicit deadline and each fresh send creates a new idempotency key. Legacy API wrapper has no visible common timeout/retry. List polling resumes after failures at fixed intervals without stale-data signaling/backoff. A completion timeout is not cancellation; reconcile by stable command ID/status and order readback before retry. No application source changed.
- Stage 26: reviewed frontend authentication, authorization boundaries and browser-exposed secrets. Confirmed localStorage token persistence, all-REACT_APP bundle injection, Google auth object logging, unguarded route definitions, optional WebSocket query-token transmission, a JSON-form dangerouslySetInnerHTML sink and hard-coded ORS key. Backend authorization, deployed values and exploitability of untrusted form labels remain unverified. No application source changed.
- Stage 27: reviewed registration document, profile and avatar upload paths; found first-file-only MIME validation, no visible size/count limits, `private: 0` on upload, weak upload response validation, missing avatar restrictions, unreleased preview object URLs and unbounded Sandbox JSON import. No frontend ZIP extraction path found; backend storage ACLs and archive handling remain unverified. No application source changed.
- Stage 28: audited npm lockfile v3 (2,124 entries) and package manifests. Identified affected locked versions of webpack-dev-server 5.2.0, PostCSS 8.5.2, minimatch 3.0.4, nested loader-utils 1.2.3, nested cross-spawn 7.0.1 and Axios 0.21.4; documented advisory ranges, conditional reachability and remediation. Also reviewed local react-dev-utils fork, package_fixed.json, install scripts and license metadata. Live npm audit/exploit reproduction not run; no application source changed.

- Stage 28 finalized: reviewed the complete npm lockfile and local dependency trees; confirmed multiple published advisory-range matches, corrected Axios findings to include CVE-2025-27152, and separated developer/build-tool exposure from browser runtime impact. No application source changed.

- Stage 29: reviewed production Vercel configuration and browser delivery. Recorded the disabled minification override, malformed CORS origin value, absent security-header declarations in repository config, public duplicate Vercel config, broad service-worker cache deletion and early browser API monkey-patching. Effective production behavior remains unverified; no application source changed.

- Stage 30: reviewed public repository and browser-delivered test tooling. Confirmed tracked emulator credentials, browser emulator credentials and real backend mutation paths; identified non-read-only diagnostic behavior and incomplete offline cleanup. Confirmed failure trace retention and a trace artifact for run #178, with token exposure risk; enumerated public-directory files copied into the build, large Agadir map data, mixed Leaflet versions, frontend FSM token exposure conditions, stale WhatsApp constants, inconsistent app/version metadata, build lifecycle mutation and missing environment-file ignore rules. Corrected the analytics-guard interpretation: it filters two URL patterns rather than all external traffic, while globally monkey-patching browser APIs. Production reachability and validity of credentials remain unverified; no application or CI source changed.
