# 03. Forms, input validation and passenger order submission

## 1. Scope and source baseline

Inspected:
- `src/components/JSONForm/*`
- `src/components/LocationInput`
- `src/components/PriceInput`
- `src/components/DateTimeIntervalInput`
- `src/pages/Passenger/VotingForm.tsx`
- `src/state/clientOrder/{selectors.ts,orderFormResolvers.ts,sagas.ts}`
- phone validation helpers and the resolver unit test.

**Baseline:** repository `Guseyn9/taxi`, branch `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`. The separate working package/branch `taxi-pr-integration/taxi` has not been identified as a GitHub branch in this repository. These findings must be rechecked against that exact pilot candidate before being treated as final acceptance defects.

No tests were run in this pass.

## 2. Passenger order form: actual submit path

The main passenger form is implemented in `pages/Passenger/VotingForm.tsx`; it is not a single HTML form with browser-native required validation. The submit buttons directly invoke `submit(mode)`.

Observed submit sequence:
1. Reject submission if the order panel is locked.
2. Read current class, seats and price values through the submission-state reader.
3. Normalize pickup/customer prices to finite non-negative numbers; invalid values become zero.
4. Resolve manually typed FROM/TO addresses if coordinates are absent.
5. Require coordinates for both points and reject points still marked `isAddressResolving`.
6. Validate phone using `getPhoneNumberError`; expand the form on error.
7. If no logged-in user, open login modal and stop.
8. Build order payload; choose order/vote/offer-specific fields.
9. Call `createOrder(payload)`, record selected mode, reset standard-order state only for standard mode, then call `onSubmit`.
10. Display safe submit error on failure and clear submitting state.

This is a useful explicit validation path, but there are inconsistencies between form resolver state, input validation and final submission (below).

## 3. Confirmed findings

### FORM-01 — Resolver treats zero-valued coordinates as missing

`VotingForm.tsx` uses finite-number checks, so latitude/longitude of zero are accepted as coordinates at submit time. But `resolveRouteFacts()` uses truthiness:
- `Boolean(facts.from?.latitude && facts.from?.longitude)`
- `Boolean(facts.to?.latitude && facts.to?.longitude)`

The resolver can therefore report a point as absent even when the submit path considers it valid. This affects automatic location class and route facts for valid coordinates on the equator or prime meridian.

**Severity:** low for Morocco-specific deployment, correctness defect in shared code. Use a shared finite-coordinate predicate.

### FORM-02 — JSONForm field-level validation captures the initial schema

In `JSONFormElement.tsx`, `validate` is created with `useCallback(..., [])` while reading the `validationSchema` prop. The schema is generated in parent `JSONForm` from current values and can change when dependent fields/visibility/required rules change. The callback continues to use the first schema for onChange/onBlur validation.

The parent performs a fresh synchronous validation on submit, so this is primarily a stale inline-error/feedback problem rather than proof that invalid data bypasses submit validation.

**Severity:** medium. Include a dynamic-required/dependent-field regression test; include schema in callback dependencies or validate through a current ref.

### FORM-03 — Checkbox and file controls bypass immediate field validation

Text, select and radio inputs use `commonProperties`, which calls `validate(value)`. Checkbox overrides `onChange` and directly calls the parent handler; file selection/removal also calls the parent handler directly. Neither path invokes the local `validate` callback.

The final `JSONForm.submitForm()` does run Yup validation, including required checkbox and required file rules. Thus submit-time enforcement exists, but immediate field-level validation/error feedback is inconsistent across input types.

**Severity:** medium for usability/accessibility; not yet a submit bypass.

### FORM-04 — Passenger resolver fallback class masks missing availability

`resolveAvailableClasses()` sets:
`fallbackClassId = firstItem(availableClasses.map(...)) ?? SITE_CONSTANTS.DEFAULT_CAR_CLASS`.

Even when `availableClasses` is empty, it falls back to the configured default class. `resolveSubmitValidation()` only marks `carClass` missing if both validated selection and fallback are absent. Therefore, with the current resolver logic, the car-class validation branch cannot report a missing class when a default class is configured.

Whether this creates a bad backend request depends on whether the default class is valid for the selected route and the server rejects it. The form's submit code reads the selected `carClass` from Redux; this resolver fallback does not itself replace the outgoing `carClass` value in the shown submit method.

**Severity:** medium/high depending on backend validation. Must test empty availability, stale selected class and route-incompatible default class.

### FORM-05 — Address resolution rejects valid zero latitude or longitude

In `VotingForm.resolveManualPointForSubmit()`, after geocoding, the result is accepted only when `address.lat` and `address.lon` are truthy. A valid coordinate of 0 is rejected. The ordinary coordinate predicate in the same component uses `Number.isFinite`, so this is an inconsistent check.

**Severity:** low for Morocco-specific use; global correctness issue. Check for property presence/finite numeric values, not truthiness.

### FORM-06 — Phone number is persisted in browser localStorage

The passenger form reads and writes `gruzvill_passenger_saved_phone` in localStorage. It strips non-digits before storage and restores the value on mount. This is a personal identifier/contact detail persisted in browser storage without an expiry in the inspected code.

This may be an intentional convenience feature, but it needs a product/privacy decision:
- disclose the persistence;
- provide a clear way to clear/change it;
- avoid retaining it on shared/public devices;
- consider session-only storage or explicit “remember phone” consent.

**Severity:** privacy review required; not automatically a blocker if disclosed and intentional.

### FORM-07 — Location input can lose the selected coordinates while editing text

When the user types in the location field, `LocationInput` calls `setPoint({ address: e.target.value })`, replacing the prior point object rather than retaining its coordinates. This is safer than accidentally submitting stale coordinates for a newly typed address, but it means every edit clears coordinates and relies on blur/Enter or submit-time geocoding to restore them.

The submit handler has a second geocoding attempt, which mitigates missed blur. Test keyboard-only entry, selection, immediate submit, geocoder failure and slow response.

**Severity:** medium usability/resilience test item; behavior appears intentional.

### FORM-08 — Partial JSON form config overwrites defaults with undefined

`PassengerOrderConfig.apply()` parses a JSON config and assigns:
`this.visibility = { ..._config.visibility }`
`this.values = { ..._config.values }`.

If a valid config supplies only one section or omits individual keys, the constructor's defaults are discarded rather than merged. Malformed JSON is ignored, but structurally incomplete valid JSON is not validated.

**Severity:** medium if server/site config can be partial. Merge defaults and validate the parsed shape.

## 4. Price entry observations

`PriceInput` has separate pickup and customer-offer segments. Numeric entry strips all non-digits, rounds configured minimums to whole currency units, clamps negative values to zero, and supports increase-only mode with a local floor.

The passenger submit method independently clamps prices to non-negative finite numbers. However:
- zero is allowed for both pickup and offer values;
- blank input is normalized to zero;
- the submit handler does not enforce a positive minimum for offer mode;
- the API layer's `postDrive` has separate backend-specific b_options compatibility/retry behavior.

No evidence from this source pass establishes what minimum amount the business rules require. The business rule must be explicitly defined (e.g. whether zero-price offer is permitted) and tested against the backend.

**Test requirement:** blank, zero, leading zeros, large values, decimal input, paste with currency symbol, increase-only floor, switching between order/vote/offer, and submit without blur.

## 5. Date/time input observations

`DateTimeIntervalInput` controls date/time enabled state, single/interval mode and comparison variants. The component updates values but does not itself enforce:
- end date is not before start date;
- end time is not before start time;
- interval completeness;
- selected date/time is in the future;
- a timezone/business timezone rule.

The inspected component may be used in administrative/search forms rather than passenger order creation. Call sites and consumer validation must be traced before classifying these as defects.

## 6. Test coverage

Repository search identified only two unit test files under the client-order state according to the repository map; the directly inspected `orderFormResolvers.test.js` currently covers trip type and button layout, but not:
- zero coordinates;
- loading state;
- empty available class list/default fallback;
- stale/incompatible selected class;
- required phone and route validation.

No dedicated component tests were found by the repository code search for `JSONForm`, `PriceInput`, `DateTimeIntervalInput`, `LocationInput` or `VotingForm`. Search indexing is not a complete substitute for a full test-tree scan, so this is a test-discovery result, not a definitive assertion that no tests exist anywhere.

The E2E suite has passenger order creation and driver/passenger flow scenarios, but these do not replace focused component/unit tests for dynamic validation and edge-case values.

## 7. Pilot test matrix to add

| ID | Scenario | Expected result |
|---|---|---|
| F-01 | Submit with FROM or TO missing | No create request; field-specific error |
| F-02 | Type address, press Enter, immediately submit | Coordinates resolved once; correct point submitted |
| F-03 | Type address, blur, submit during slow geocode | No duplicate/incorrect point; clear pending/error state |
| F-04 | Geocoder unavailable for manually typed address | No create request; actionable field error |
| F-05 | Valid coordinate contains zero | Accepted consistently by resolver and submit |
| F-06 | Phone empty/short/long/valid | Same rule in selector and submit |
| F-07 | User logged out, otherwise valid form | Login flow; no order creation before auth |
| F-08 | No available car classes | Explicitly block or documented fallback; never silently send invalid class |
| F-09 | Selected car class becomes unavailable after route edit | Re-resolve class; show selected/fallback state |
| F-10 | Required JSONForm field becomes required dynamically | Current schema used for immediate and submit validation |
| F-11 | Required checkbox/file left empty | Visible validation error and submit blocked |
| F-12 | Offer mode with blank/zero/positive price | Matches explicit business rule and backend contract |
| F-13 | Date interval end before start | Rejected if consumer requires ordered interval |
| F-14 | Saved phone on shared browser | Persistence/consent behavior matches product policy |

## 8. Priority summary

| ID | Priority | Disposition |
|---|---|---|
| FORM-02 | Medium | Fix stale schema closure; add dynamic validation test |
| FORM-03 | Medium | Make checkbox/file immediate validation consistent |
| FORM-04 | Medium/high | Clarify fallback semantics; test backend route/class constraints |
| FORM-08 | Medium | Merge/validate partial site config |
| FORM-06 | Privacy review | Decide consent, retention and clearing behavior |
| FORM-01 / FORM-05 | Low for Morocco; correctness | Standardize finite-coordinate handling |
| FORM-07 | Test item | Verify keyboard/slow-network behavior |
| Price/date items | Contract-dependent | Define business rules and validate at submit boundary |

## 9. Next audit step

Continue with the driver-side forms and actions:
1. Driver registration/profile/car forms and document upload.
2. Driver offer/accept/take-order forms and their validation.
3. Trip completion, rating, waiting-time and cancellation inputs.
4. Confirm that all validation is repeated server-side and that frontend messages map backend error codes safely.
