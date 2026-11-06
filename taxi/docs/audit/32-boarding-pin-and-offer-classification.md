# 32. Boarding PIN and Offer classification contract review

**Baseline:** `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`  
**Audit branch:** `audit/frontend-inventory`  
**Scope:** source and existing E2E specification review only. No backend source, live tenant, or production deployment was inspected. No application source changed.

## Executive result

The two P0 topics are not interchangeable:

- **Boarding code** is a Voting-only gate. The driver map routes a Voting order from Arrived to its order card; non-Voting orders (including Offer) use the direct Start action.
- **Offer classification** cannot safely rely on `b_cars_count` after a backend round trip. The source has a fallback based on customer price plus intercity location/car class. The E2E fixture validates the observed gruzvill contract using customer price plus `b_location_class`.

Neither source inspection nor frontend E2E documentation proves that backend authorization, PIN attempt limits, replay protection, or concurrent command atomicity are correct.

## 1. Boarding code: observed frontend contract

### Source path

1. `src/pages/Driver/Map.tsx`: when effective driver state is `Arrived`, `isVotingOrder(order)` changes the primary action to the Voting code-confirmation action. `onMapStartedClick` opens the order card for Voting; all other orders call `driverMapGateway.start(orderId)`.
2. `src/pages/Order/index.tsx`: `onVotingConfirmCode` normalizes the entered value and calls `isBoardingCodeAccepted(order?.b_driver_code, enteredCode)`. On local rejection, the command is not sent. On acceptance, it calls `confirmDriverBoarding` through `driverMapGateway.confirmBoarding`.
3. `src/tools/driverBoarding.ts`: the local validator requires 3–4 digits. If the order contains a valid expected `b_driver_code`, it compares equality. If the expected value is absent or malformed, any syntactically valid code is allowed through to backend verification.
4. `src/platform/adapters/DriverMapGateway.ts`: legacy path calls `confirmVotingCode(orderId, code)`, then `setOrderState(orderId, Started, code)`; the configured FSM path sends the code as `boardingCode` and waits for command completion before publishing `BoardingConfirmed`.
5. `src/tools/driverBoarding.ts` performs local state synchronization and the post-boarding callback only after the gateway promise resolves. `DriverBoardingProjection` then records Started and refreshes the order.

### Existing test evidence

`e2e/driver-boarding.spec.ts` defines four scenarios:
- valid code advances backend and UI to Started;
- malformed two-digit code is rejected and the order remains Arrived;
- two rapid clicks do not break the Started state;
- reload retains Started and does not reopen the code form.

The spec documents that its backend assertions are independent of UI state. Stage 31's run #178 was a different suite summary; the existence of this spec does not establish that this particular suite was executed in run #178.

### Findings and limits

- **Observed in source:** local format validation and optional equality check are client-side safeguards, not an authorization boundary.
- **Unverified:** server-side comparison against the correct order/driver's code, authorization that the caller is the appointed driver, PIN attempt throttling/lockout, expiry, replay behavior, and audit trail. Backend implementation is not in this repository.
- **Test gap:** the negative E2E case uses `'12'`, which fails format validation before reaching the backend. There is no demonstrated E2E assertion here that a syntactically valid but incorrect 3–4 digit code is rejected by the backend while state remains Arrived.
- **Concurrency limit:** the double-click test proves the resulting state, but the source/spec alone does not prove backend exactly-once execution or atomicity under simultaneous requests.

**P0 status:** not closed. Require backend evidence and a live negative test with a valid-format wrong code, plus unauthorized-driver and replay/concurrency checks.

## 2. Offer classification: observed frontend contract

### Source path

`src/tools/driverOffer.ts:isOfferOrder` rejects Voting and stored simple-order mode first. It then recognizes Offer using stored mode, the legacy `b_cars_count === "0"` marker, explicit order/options mode, customer price together with intercity location class or intercity car class, `b_only_offer`, and explicit offer options.

`src/tools/convert.ts:convertOrder` converts `b_cars_count` with `parseInt`. This conversion cannot restore a marker that the backend has already changed.

The repository's E2E documentation records a gruzvill observation: `b_cars_count=0` is returned as `"1"`; `b_only_offer` is not returned; and `b_options.order_mode` is not accepted by that backend. The E2E snapshot helper therefore checks non-Voting + customer price + intercity location class. The Offer E2E spec explicitly checks this classification and the two-driver offer/selection path.

### Findings and limits

- **Observed in source:** the application contains fallback classification paths beyond `b_cars_count`; the frontend does not depend exclusively on the zero marker.
- **Documented, not independently re-measured in this audit:** gruzvill's normalization of `b_cars_count` and omission/rejection of the other markers.
- **Potential contract fragility:** the E2E snapshot helper models only the intercity-location + customer-price branch. Production `isOfferOrder` also supports intercity car-class and other explicit markers. The fixture helper is appropriate for its constructed fixture, but it is not a complete mirror of every production classification branch.
- **Unverified:** whether all Moroccan pilot tenant configurations preserve the customer-price field and intercity class values through create, list, detail, refresh, and FSM snapshots. No live API calls or backend source were available in this review.

**P0 status:** partially mitigated in frontend source; not closed for pilot until the actual tenant's create/read round-trip is tested and the canonical backend classification contract is agreed.

## 3. Required next verification

1. Run the dedicated `driver-boarding` E2E suite against the target pilot tenant.
2. Add a valid-format wrong-code test and verify backend state remains Arrived; verify unauthorized driver and repeated/replayed confirmation.
3. Verify the server's atomic transition and command idempotency under two concurrent confirmations.
4. Create/read Offer orders on the target tenant and compare raw create payload, list snapshot, detail snapshot, and FSM event/snapshot. Include the backend's actual field types and values.
5. Add classification regression tests for the production branches: customer-price + intercity location class, customer-price + intercity car class, explicit Offer marker, and Voting exclusion.

## Evidence links

- [driverOffer.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/driverOffer.ts)
- [convert.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/convert.ts)
- [DriverMapGateway.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/platform/adapters/DriverMapGateway.ts)
- [driverBoarding.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/src/tools/driverBoarding.ts)
- [driver-boarding.spec.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/driver-boarding.spec.ts)
- [offer-order.spec.ts](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/offer-order.spec.ts)
- [E2E README](https://github.com/Guseyn9/taxi/blob/8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf/taxi/e2e/README.md)

