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

## Change log

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
