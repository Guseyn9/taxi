# 33. Pricing, currency and fare calculation contract

## Scope and baseline

Reviewed selected `main` source at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. This stage continues Work package B (pricing) and D (Morocco tenant configuration). It is a source-level review only: no live tenant configuration, backend quote, or deployed UI was queried. No application source changed.

## 1. Currency is service-global, not order-scoped

### Observed in source

- `src/siteConstants.ts:Currency` initializes `NAME='RUB'` and `SIGN='₽'`.
- `CURRENCY.recalculated()` reads `site_constants.currency_of_the_service` with default `RUB`, then looks up `window.data.currencies[NAME].abbr`; if the currency metadata is absent, the symbol falls back to `₽`.
- `src/state/config/sagas.ts:setConfigLoadedSaga` calls `SITE_CONSTANTS.recalculate()` and `CURRENCY.recalculated()` when the configuration-loaded action is handled.
- `formatCurrency` uses the global `CURRENCY.NAME` with `Intl.NumberFormat`. The helper does not receive an order or inspect `order.b_currency`.
- Passenger order creation in `src/pages/Passenger/VotingForm.tsx` does not include `b_currency` in the payload. Currency is therefore implicitly determined by tenant/service configuration, not persisted explicitly by this frontend request.

### Findings

**P0-PRICE-33-01 — Morocco MAD is a tenant-configuration acceptance gate.**

The code defaults to RUB and a ruble symbol. For an Agadir/Morocco pilot, the effective tenant config must provide `currency_of_the_service = MAD` and a matching `currencies.MAD.abbr`, and the config-loaded lifecycle must complete before money is shown. Otherwise the UI can show a RUB default or an inconsistent currency code/symbol. This is not verifiable from the public source alone.

**P1-PRICE-33-02 — Currency formatting is global and cannot represent mixed-currency order history.**

Formatting ignores `order.b_currency`. A single-currency tenant can operate with this model if configuration is stable, but historic orders or multi-currency operation cannot be rendered reliably when their stored currency differs from the current service setting.

## 2. Fare calculation and configuration defaults

### Observed in source

- `getPayment` returns `b_options.customer_price` only when the value is truthy and `SITE_CONSTANTS.ENABLE_CUSTOMER_PRICE` is enabled. Otherwise it calculates a fare from distance, call rate, fare-per-kilometer, and night multiplier.
- `PriceInput` can force customer-price controls for Offer/Voting flows independently of the global `ENABLE_CUSTOMER_PRICE` flag.
- In `src/siteConstants.ts`, the declared default for `COURIER_FARE_PER_1_KM` is `2.5`, but `Constants.recalculate()` reads the same setting with fallback `defaultValues.COURIER_CALL_RATE` (10), not `defaultValues.COURIER_FARE_PER_1_KM`.
- `getPayment` then uses the recalculated value as the per-kilometer rate when the car class does not provide one.

### Findings

**P1-PRICE-33-03 — Per-kilometer fallback is inconsistent with its declared default.**

If the tenant omits `courier_fare_per_1_km` and the selected car class has no override, the effective rate becomes 10 rather than the declared default 2.5. This can multiply the distance component of a calculated fare by four. Confirm whether the Morocco tenant always supplies the setting; otherwise correct the fallback and add a config-default unit test.

**P1-PRICE-33-04 — Customer-price visibility and customer-price calculation use different gates.**

Offer/Voting UI can force the customer-price input even when `ENABLE_CUSTOMER_PRICE` is false, while `getPayment(order)` ignores `customer_price` under that flag and falls back to calculated fare. Some surfaces separately render customer price directly, so different screens may show different amounts under a mismatched configuration. Verify the actual tenant flag and unify the rule: Offer's customer price should be shown as the agreed offer amount regardless of the generic Standard customer-price feature flag, if that is the product contract.

## 3. Pricing-model final calculation

### Observed in source

- `calculateFinalPriceFormula` and `calculateFinalPrice` independently substitute values into `b_options.pricingModel.formula`.
- The display-formula function supplies `submit_price` from `b_options.submitPrice`.
- The numeric calculation function instead supplies a property named `submit_rice` (typo) from the same source field. A formula containing `submit_price` is therefore not substituted by that function and can fail evaluation or produce a result inconsistent with the displayed formula.
- The numeric calculation uses `eval(formula)` and truncates the result with `Math.trunc`. The display-formula path truncates option values while substituting them. These are separate rounding/truncation paths.
- `RatingModal` computes and displays the final price locally from the pricing model after trip completion. The reviewed frontend path does not establish that this displayed value is the backend's settled/charged amount.

### Findings

**P1-PRICE-33-05 — Formula display and numeric calculation can disagree for submit-price formulas.**

The `submit_price` / `submit_rice` mismatch is directly observable in source. No dedicated test for `calculateFinalPrice` or `calculateFinalPriceFormula` was found in the source search performed for this stage. Add paired tests proving the displayed expression and numeric result use identical substitutions, including missing, zero, fractional and incomplete values.

**P1-PRICE-33-06 — Final-price rounding and source of truth are not established.**

The frontend truncates rather than rounds the evaluated result and locally derives the final display from the pricing model. The backend's authoritative final fare, currency, rounding policy, and reconciliation with this UI result are not established by the reviewed frontend source. Do not treat the RatingModal value as a receipt or settlement proof without backend readback.

## 4. Quote expiry and mutable price

No server-issued quote identifier, quote expiry timestamp, signature, or frontend-enforced quote-expiry contract was identified in the reviewed order creation and pricing paths. This is a bounded source finding, not proof that the backend has no quote expiry.

For pilot acceptance, obtain the backend contract and test:
- whether an estimated fare is informational or a binding quote;
- whether a passenger's Offer/customer price is immutable after driver selection;
- when and by whom the final amount is calculated;
- whether duration/distance changes are bounded and disclosed;
- the exact MAD rounding rule and minimum fare;
- whether stale quotes are rejected or re-quoted before order creation.

## 5. Verification matrix

| Claim | Evidence | Status |
|---|---|---|
| Currency defaults to RUB | `siteConstants.ts:Currency` | Observed in source |
| Tenant config recalculates currency after config-loaded action | `state/config/sagas.ts` | Observed in source |
| Agadir pilot actually loads MAD and correct abbreviation | Live tenant configuration | Unverified |
| Per-km fallback equals declared 2.5 default | `siteConstants.ts:Constants.recalculate` | False; fallback references call rate |
| Offer price always takes precedence in `getPayment` | `tools/utils.ts` + `PriceInput` | False under feature-flag mismatch |
| `submit_price` substituted identically in display and numeric formula | `tools/order.ts` | False; numeric path spells key `submit_rice` |
| Frontend final price equals backend settlement | Backend contract/readback unavailable | Unverified |
| Quote expiry is enforced | No frontend quote contract found in reviewed paths | Unverified |

## 6. Pilot disposition

- **MAD currency: BLOCKED pending tenant-config evidence.** Confirm the live config values and verify the displayed code/symbol in the actual pilot deployment before accepting money-related flows.
- **Fare defaults: BLOCKED if tenant/car-class rates are absent.** The per-kilometer fallback is inconsistent with the declared default.
- **Offer price display: verify flag compatibility.** Forced Offer input and generic customer-price display currently use different conditions.
- **Pricing model: requires correction and tests** for the `submit_price` substitution mismatch; backend settlement and rounding remain unverified.
- No live tenant API/config request, E2E execution, backend mutation, or source change was made in this stage.
