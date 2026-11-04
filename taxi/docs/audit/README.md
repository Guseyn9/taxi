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
3. Forms and user-input validation.
4. Components and page-level user flows.
5. Redux, Saga, Thunk and state ownership.
6. Platform Interface, FSM transports and legacy adapters.
7. Runtime configuration, build and external integrations.
8. Test coverage, gaps and pilot-readiness conclusions.

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
| 3–8 | Not started | To be added |

## Change log

- Initial audit documentation created on branch `audit/frontend-inventory`, based on the pinned `main` commit above.
- Added API register, endpoint map and confirmed source-level risks in `02-api-register.md`.
- Deepened route/geocoding review: confirmed browser-visible ORS key, mock-backed area graph dependency, zero-coordinate checks and duplicate route fallback implementations.
