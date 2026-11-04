# 04. Driver forms, profile documents and order actions

## 1. Source baseline and scope

**Evidence baseline:** `Guseyn9/taxi`, branch `main`, commit `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`.

Inspected:
- `components/modals/LoginModal/Register.tsx`
- `components/modals/ProfileModal.tsx`
- `components/modals/DriverCancelModal.tsx`
- `pages/Order/index.tsx`
- `API/order.ts`
- `tools/driverStatus.ts`, `tools/driverOffer.ts`
- `components/MiniOrders/index.tsx`
- relevant E2E specs and API/driver-flow tests discovered by repository search.

This is a source review only. No tests were run and no live backend requests were made. The actual pilot candidate branch `taxi-pr-integration/taxi` has not been located in this repository; verify every finding against the intended frontend package before treating it as a release defect.

## 2. Driver registration

The registration component uses React Hook Form with Yup. It validates:
- user name;
- email or phone depending on selected registration type;
- password (minimum 8 characters);
- password confirmation;
- driver-specific address/card fields depending on `requireFeildsMap`;
- passport, driver-license and vehicle-license images depending on server-provided requirements.

Driver registration sends a combined payload containing user details, vehicle attributes and uploaded files. File inputs are gathered into an `uploads` array and passed to the registration thunk.

### DRV-FORM-01 — Registration contract depends on runtime requirement map

The schema and the extra `isValidFrom` checks both depend on `requireFeildsMap`. This is intentional server-driven validation, but a missing, stale or incomplete map can change which driver fields are required. The inspected source does not establish what the production configuration returns for the pilot tenant.

**Disposition:** verify the actual config payload for the pilot city and test every required/optional combination. Do not infer driver registration readiness from the component alone.

### DRV-FORM-02 — Document type selector is populated from car models

The field labelled `Document type` uses `prepareOptions(data?.car_models, TRANSLATION.CAR_MODELS)`, and the source itself contains a TODO saying the options should be changed to document types.

**Severity:** medium; potentially confusing or incorrect registration data. Confirm whether the field is still shown in the pilot registration route and whether backend expects a document-type identifier or a car-model identifier.

### DRV-FORM-03 — Registration includes a vehicle object before approval

The registration payload always constructs `u_car` from form values (model, seats, registration plate, color and class) alongside uploads. This is not necessarily a defect: the backend may create a pending car record. It does mean that the frontend's successful registration message must not be interpreted as approval to operate.

**Disposition:** verify the returned user/car check states and ensure the UI blocks going online until both are approved.

## 3. Driver profile and vehicle editing

The profile modal:
1. Loads passport and driver-license images from user details.
2. Builds a comparison snapshot of user, driver details and primary car.
3. Validates a changed referral code via backend.
4. Saves car edits or creates a car if none exists.
5. Uploads newly selected images through `backendGateway.uploadFile`.
6. Chooses editable driver fields based on `u_check_state` (Required, Active or another state).
7. Sends changed driver details to `editUser`, then refreshes user data.

### DRV-FORM-04 — Profile save is multi-request and not atomic

Vehicle changes are sent before document uploads and the subsequent user-details update. If the car save succeeds but image upload or user update fails, the profile is left partially updated. The UI displays an error, but cannot roll back the already saved car change.

**Severity:** medium. The interface should report partial success precisely and allow retry without duplicating or overwriting data. Backend transaction/workflow support would be needed for true atomicity.

### DRV-FORM-05 — Uploaded document response is accepted only when dl_id exists, without explicit failure

For each new image, the code appends `res.dl_id` only when present. If the upload call resolves with a response that has no `dl_id`, the current flow does not explicitly throw at that point. The later user-details update can therefore proceed with an incomplete image list.

**Severity:** medium/high for driver onboarding. Require a valid upload identifier for every new file; otherwise stop and show a recoverable error.

### DRV-FORM-06 — Driver profile fields are state-dependent

The fields submitted to `editUser` are selected from `DRIVER_CHECK_REQUIRED_FIELDS` or `DRIVER_CHECK_ACTIVE_FIELDS` according to the current check state. This is a deliberate restriction, but the code path depends on the state value being current and correctly mapped.

**Disposition:** test the transitions Required → Active → rejected/other, and verify which fields remain editable. Confirm that changing car data does not accidentally bypass required driver re-verification.

## 4. Driver order actions

### 4.1 Offer mode

The driver order page reads offer price, ETA and comment from the form. ETA is required through React Hook Form and has predefined quick choices and longer choices. Price is converted with `Number(values.offerPrice)`; in the inspected submit handler there is no explicit local check that the price is finite, positive or within a business-defined maximum before calling `sendOrderOffer`.

The API method obtains the current user's car, then sends `SetPerformer` to `POST /drive/get/{id}`. The payload includes the price, ETA, comment and performer data.

### DRV-ACT-01 — Offer price validation is not explicit at the action boundary

The page constructs `price: Number(values.offerPrice)` without a visible local finite/positive/range check in the inspected handler. Form registration and disabled-button conditions may provide some validation, but the API action itself does not enforce a business range.

**Severity:** medium, contract-dependent. Define the accepted price range and enforce it at both UI and backend. Test blank, zero, negative, decimal, very large and non-numeric values.

### DRV-ACT-02 — Offer/voting API contains a safe payload builder but does not retry with it

`API/order.ts` defines:
- `buildDriverOfferPerformerData(..., safeOnly)`;
- `buildVotingCandidateData(..., safeOnly)`;
- `getWrongCOptionsKeys(error)`.

The comments explain that the backend may reject unregistered `c_options` keys such as `driver_offer_eta` and `driver_offer_comment`. However, the inspected `_sendOrderOffer` and `_participateVotingOrder` each call `postOffer(false)` / `postVoting(false)` and return that promise. The safe-only variants are defined but are not invoked as a retry in these functions.

This contradicts the apparent fallback intent and leaves a configuration-sensitive backend rejection path.

**Severity:** high if the pilot backend does not allow the extended keys. Confirm active `c_options_valid_keys`; either remove unsupported keys from the first request or implement a carefully bounded retry only when the backend explicitly reports `wrong c_options keys`. Ensure no duplicate performer assignment can occur after an ambiguous response.

### DRV-ACT-03 — Driver offer response state is partly browser-local

The order page stores offer details and client response state in localStorage via `driverOffer.ts`. The source includes a 15-minute offer lifetime and local event dispatch. The backend offer object is also read when available, but the local store is used as a fallback and for response-state handling.

**Severity:** medium; multi-device and browser-reset consistency risk. Verify which response statuses are server-authoritative and which are simulated/local. A driver switching devices or clearing storage must not see an incorrect offer state.

### DRV-ACT-04 — Declining a client-selected offer is a local hide/decline action

The inspected `declineClientSelectedOffer` updates the local response status, removes the locally stored offer, hides the order and navigates away. No backend mutation is visible in that handler.

**Severity:** medium/high if this is intended as a real driver decline rather than a UI-only action. Confirm the product contract: if the server must know the decline, this handler is incomplete. If local-only is intentional, document the behavior and ensure passenger UI does not continue to treat the offer as pending.

### 4.2 Voting participation and ordinary take-order

Voting participation calls `participateVotingOrder` with `performers_price` and ETA. Ordinary orders call `takeOrder(id, getValues(), isCandidate)`. The page refreshes the order after success and displays a success modal. Errors are displayed using a readable API error helper for ordinary take-order; offer/voting branches use a mixture of `error.toString()` and generic translation.

**Disposition:** add explicit tests for missing linked car, backend duplicate participation, order already assigned, network timeout after server acceptance, and retry. Verify that an ambiguous timeout does not lead to duplicate participation or a misleading failure message.

## 5. Driver lifecycle and cancellation

- Arrived/start/finish actions route through `driverMapGateway` in the inspected order page.
- Start/boarding for voting orders uses a guarded code-confirmation flow; it checks the entered door code, sets a synchronous pending ref to prevent double clicks, calls the gateway and refreshes multiple state slices.
- `API.setOrderState` maps Arrived, Started and Finished to backend actions and rejects unsupported states.
- `setWaitingTime` posts previous and additional waiting seconds.
- Driver cancellation marks the order locally as cancelled-by-driver, then calls `passengerGateway.cancelOrder`; on failure it clears the local marker.

### DRV-ACT-05 — Finish action requires local started timestamp

The page checks `driver?.c_started` before allowing completion. This is a client-side guard; it is not proof that the backend independently validates the trip state or that the timestamp is current.

**Disposition:** verify server-side transition validation and test stale client state, refresh during trip and duplicate finish click.

### DRV-ACT-06 — Waiting-time action has no visible client-side range enforcement in API wrapper

The API wrapper accepts `previous` and `additional` values and posts them directly. Default additional time is 180 seconds. No range/finite checks are visible in the wrapper.

**Severity:** medium, contract-dependent. Define permitted values and verify server-side bounds; add client validation if the UI can produce arbitrary values.

### DRV-ACT-07 — Driver cancellation is optimistic only in local presentation

The cancellation marker is written before the backend request and cleared on rejection. This is a common optimistic UI technique, but any failure to clear the marker (e.g. page closure during request) can temporarily misclassify the cancellation in local storage/state.

**Disposition:** verify marker TTL/cleanup and reload recovery. Backend state remains authoritative.

## 6. E2E and unit-test evidence discovered

Repository search found E2E specs for:
- driver boarding;
- offer order and driver decline;
- standard order;
- trip finish and interruption;
- voting order.

The E2E README documents a backend-specific issue: the initial `set_performer` request may be rejected with an HTTP 200 response whose body contains `status=error code=404`, after which the test harness retries without `b_driver_code`. This is important historical evidence, but must be revalidated against the current pilot backend/config.

The source review did not execute these tests. Presence of E2E specs does not establish a passing current run, and no test result from the unavailable production server is claimed here.

## 7. Pilot acceptance test matrix

| ID | Scenario | Expected result |
|---|---|---|
| D-01 | Register driver with all required docs | Registration accepted; user/car remain pending until approved |
| D-02 | Omit each required doc in turn | Submit blocked with field-specific error |
| D-03 | Document type selection | Values are actual document types, not car models |
| D-04 | Upload resolves without `dl_id` | Profile update stops; no incomplete document reference is saved |
| D-05 | Car update succeeds, document upload fails | UI clearly reports partial save and offers safe retry |
| D-06 | Change profile while check state changes | Only currently permitted fields are sent |
| D-07 | Offer blank/zero/negative/large price | Explicit business rule enforced before API call |
| D-08 | Backend rejects unsupported `c_options` key | No duplicate performer; safe fallback or clear error |
| D-09 | Driver changes device/browser after sending offer | Offer and response state remain consistent |
| D-10 | Passenger selects offer, driver declines | Backend and passenger see a consistent declined state |
| D-11 | Two rapid take-order clicks | Exactly one performer assignment |
| D-12 | Request times out after backend accepted take-order | UI reconciles backend state; no duplicate assignment |
| D-13 | Start/finish with stale local state | Backend rejects invalid transition; UI refreshes |
| D-14 | Waiting time below/above allowed bounds | Server and UI enforce agreed limits |
| D-15 | Driver cancellation request fails | Local cancellation marker is cleared and order remains actionable |

## 8. Priority summary

| ID | Priority | Next action |
|---|---|---|
| DRV-ACT-02 | High/config-dependent | Verify active backend key allowlist; fix/retest fallback behavior |
| DRV-FORM-05 | Medium/high | Require upload `dl_id` before saving user details |
| DRV-ACT-04 | Medium/high | Confirm decline is server-authoritative or intentionally local |
| DRV-FORM-04 | Medium | Handle partial profile saves and retry |
| DRV-ACT-01 / 06 | Medium, contract-dependent | Define and enforce numeric bounds |
| DRV-FORM-01 / 03 / 06 | Acceptance verification | Test actual config and approval states |
| DRV-ACT-03 / 05 / 07 | Resilience verification | Test cross-device, stale state and interrupted requests |

## 9. Next audit step

Proceed to page-level component flows and state ownership:
1. Driver map, order card and mini-order card: visibility/action gating by order state.
2. Passenger active-order, candidate selection and cancellation flows.
3. Modals and confirmations: ensure no action can be triggered from stale or conflicting state.
4. Trace every UI action to the Redux/Saga/gateway/API path and identify duplicate sources of truth.
