# Frontend audit

## Scope and working rules

- Repository: `Guseyn9/taxi`
- Baseline branch: `main`
- Baseline commit: `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit working branch: `audit/frontend-inventory`
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
8. Test execution/coverage reconciliation and pilot-readiness conclusions.

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
