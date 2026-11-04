# 32. Boarding-code authority and Offer classification contract

## Scope and baseline

Source reviewed on `main` at baseline `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. This stage continues Work package B, prioritizing the P0 boarding-code contract and the Offer marker degradation observed on the live `gruzvill` configuration. Documentation only; no application source or CI files changed.

Evidence labels below distinguish source observations, repository-recorded live-backend measurements, test coverage, and items that still require fresh runtime confirmation.

## 1. Boarding-code flow: frontend shape check is not authentication

### Observed in source

- `src/tools/driverBoarding.ts:isBoardingCodeAccepted` normalizes both values and requires the entered value to match `DRIVER_DOOR_NUMBER_PATTERN` (3–4 digits). If the order has no valid `b_driver_code`, it accepts **any** entered value with the right shape. This is explicit fallback behavior, not a comparison against a secret.
- `src/pages/Order/index.tsx` and `src/components/modals/CardModal.tsx` call that local check before invoking `confirmDriverBoarding`.
- `confirmDriverBoarding` waits for the gateway promise before synchronizing local state or running the boarded callback. Its unit tests verify ordering and that a rejected gateway call does not update local state.
- In the legacy gateway branch, `DriverMapGateway.handleAction` calls `backendGateway.confirmVotingCode(orderId, code)`, then calls `backendGateway.setOrderState(orderId, Started, code)` unless `updateState === false`.
- `src/API/order.ts:confirmVotingCode` is an in-memory stub: it resolves with a success-shaped object and performs no HTTP request. The actual legacy backend mutation is `set_start_state`, which includes `b_driver_code` when supplied.
- In the configured server-command branch, `DriverMapGateway` sends the code as `{ boardingCode }` with the ConfirmBoarding intent and waits for command completion. Server-side validation is outside this frontend repository.

### Documented live-backend evidence

The existing `e2e/README.md` records a direct API measurement on `gruzvill`: `set_start_state` with an intentionally incorrect `b_driver_code` returned success and moved the driver to `Started(5)`. It also records that `b_driver_code` is empty in the order response. Consequently, the frontend's local check accepts any 3–4 digit value and the backend, on that measured configuration, does not reject a wrong value.

This is a recorded prior live measurement, not a fresh request made in this stage. The current source still contains the same fallback and stub path.

### Tested

- `src/tools/driverBoarding.test.ts` tests local equality when an expected code exists, shape-only acceptance when it is absent, and sequencing of state sync after gateway success.
- The tests mock the gateway promise; they do not prove that the real backend rejects an incorrect code.
- Existing E2E documentation explicitly states that the current backend cannot satisfy the negative security requirement “wrong code → command failed and backend not Started”; the current E2E can only reject malformed shape locally. This limitation must not be presented as successful boarding-code verification.

### Findings

**P0-BRD-32-01 — Boarding code is not a verified passenger-presence/authentication factor on the measured backend.**

The code is not returned to the client, the frontend falls back to shape-only validation, and the measured `set_start_state` endpoint accepts a wrong code. A 3–4 digit value is therefore not proof that the passenger supplied a correct code. This is a backend contract/security blocker if boarding-code verification is a pilot requirement.

**P0-BRD-32-02 — Legacy `confirmVotingCode` success is synthetic and must not be counted as backend validation.**

The method always resolves locally. Only the subsequent `set_start_state` call can affect the real legacy backend state; its observed behavior currently does not enforce the code. In the FSM/server-command branch, validation behavior remains unverified and must be tested independently. The two transport branches must not be assumed equivalent based on frontend unit tests.

**Required backend acceptance contract:**
1. Generate and persist a high-entropy or sufficiently unpredictable, order-scoped boarding secret.
2. Return it only to the passenger authorized for that order; never expose it to the driver/order snapshot.
3. Validate it server-side on the atomic Arrived → Started transition, checking order ID, assigned driver, passenger/order relationship, current state and expiry.
4. Reject wrong, expired, replayed and cross-order codes without changing driver/order state.
5. Apply bounded attempts/rate limiting and audit outcomes without logging the secret.
6. Make legacy and FSM command transports enforce the same rule.
7. Add live-backend negative E2E cases proving wrong code leaves backend state unchanged, then a correct code succeeds exactly once.

Do not try to repair this security property with a stricter frontend-only comparison.

## 2. Offer classification after backend normalization

### Observed in source

- `src/tools/driverOffer.ts:isOfferOrder` first excludes Voting and stored Standard mode, then checks stored Offer mode, `b_cars_count === "0"`, explicit order/options mode, customer price combined with intercity location/car class, and `b_only_offer`.
- `src/tools/convert.ts:convertOrder` converts `b_cars_count` to an integer. A backend value of `"1"` becomes `1`; it cannot preserve a lost zero marker.
- `src/pages/Passenger/VotingForm.tsx` creates Offer payloads with `customer_price` and the chosen location class.
- The E2E helper `e2e/fixtures/taxiApi.ts:isOfferOrderSnapshot` separately implements a narrower snapshot predicate based on non-Voting + customer price + intercity location class. The E2E tests therefore do not directly call the production `isOfferOrder` function.

### Documented live-backend evidence

The existing `e2e/README.md` records that on `gruzvill`:
- submitted `b_cars_count=0` returns as `"1"`;
- `b_only_offer` is accepted but omitted from the order response;
- `b_options.order_mode` is not accepted by the backend;
- the surviving identifying combination is intercity location class plus `b_options.customer_price`.

The current `offer-order.spec.ts` uses that observed contract and explicitly verifies that the Offer form is available and two different drivers can submit separate offers.

### Findings

**P1-OFFER-32-01 — Offer classification depends on a composite backend field contract, not a durable server mode.**

The frontend has several fallback markers, but the measured tenant strips or rewrites the most direct markers. On that tenant, correct classification depends on the customer-price/intercity combination surviving reads. A future backend change to either field's shape or omission can silently downgrade Offer to Standard. The contract should be made explicit and versioned server-side.

**P1-OFFER-32-02 — E2E snapshot oracle duplicates rather than imports the production Offer detector.**

The E2E helper's predicate is not the same implementation as `src/tools/driverOffer.ts:isOfferOrder`; it checks only the measured customer-price/intercity pair. The UI scenario provides useful end-to-end evidence, but the duplicated oracle can drift and cannot by itself certify every production detector branch. Add unit tests against the production detector for Voting exclusion, stored mode precedence, marker loss, customer-price/intercity fallback, and ordinary intercity orders without Offer intent.

## 3. Verification matrix

| Claim | Evidence | Status |
|---|---|---|
| Missing order code permits shape-only local acceptance | `driverBoarding.ts` + `driverBoarding.test.ts` | Observed/tested |
| Legacy `confirmVotingCode` makes a network request | `API/order.ts` implementation | False; local stub |
| Legacy start sends `b_driver_code` when supplied | `API/order.ts:setOrderState` | Observed in source |
| Measured `gruzvill` rejects a wrong code | Existing `e2e/README.md` live measurement | False on measured configuration |
| FSM command validates boarding code | Server-side implementation unavailable here | Unverified |
| Offer marker `b_cars_count=0` survives backend | Existing `e2e/README.md` measurement | False on measured configuration |
| Offer customer-price/intercity fallback works in current E2E | `offer-order.spec.ts` and recorded run history | Tested historically; no new execution in this stage |
| Production Offer detector and E2E oracle are identical | Source comparison | False; separate implementations |

## 4. Pilot disposition

- **Boarding-code verification: BLOCKED** until server-side validation is implemented and demonstrated on the actual pilot backend in both legacy and FSM paths. Current frontend tests prove UI sequencing and format validation only.
- **Offer classification: CONDITIONALLY ACCEPTABLE** for the measured `gruzvill` contract, provided the live tenant continues returning both customer price and intercity class. Add direct production-detector unit coverage and a server-owned canonical mode before broader rollout.
- No source changes, backend changes, live API calls, or new E2E runs were made in this stage.
