# 44. Order pricing formula is evaluated as JavaScript in the browser

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: trace the order pricing formula from the API response through conversion and browser execution; identify consumers and test coverage.
- Method: static source tracing and GitHub code search at the pinned baseline. No payload was executed. No application source changed. No tests were executed.

## Executive result

**High severity; P1 security gate.** The frontend executes `order.b_options.pricingModel.formula` using JavaScript `eval()`. The formula is part of the order object returned by the backend. The normal API conversion path does not validate or constrain the formula before it reaches the pricing helper. The helper performs placeholder substitutions and then evaluates the resulting string as JavaScript.

This is not merely a mathematical parser. If a party able to influence the returned formula can supply JavaScript, that code runs in the application origin with the privileges of the current browser session. In particular, same-origin browser storage and authenticated application state may be exposed to the injected code.

The repository does not establish whether ordinary passenger-created orders can set or alter `pricingModel.formula`, or whether the backend exclusively generates it from administrator-controlled pricing configuration. That authorization/data-integrity boundary is **unverified**. The unsafe browser execution sink itself is directly observed.

## SEC-44-01 — Backend order formula is executed with JavaScript eval

**Severity: High (P1); Critical impact if a lower-privilege account or compromised upstream data source can influence the formula.**

### Source path

1. `src/types/types.ts` defines `b_options.pricingModel.formula` as a string.
2. `src/API/order.ts` obtains orders from the backend:
   - `getOrders` calls `POST ${Config.API_URL}/drive` (or `/drive/now`, `/drive/archive`) and maps returned booking records through `convertOrder(item)`.
   - `getOrder` calls `POST ${Config.API_URL}/drive/get/${id}`, extracts `res.data.data.booking[id]`, and passes it through `convertOrder`.
3. `src/tools/convert.ts` converts selected coordinate, numeric, date, boolean and driver fields. It does not validate, parse, whitelist or normalize `b_options.pricingModel.formula`.
4. `src/tools/order.ts::calculateFinalPrice` reads `order.b_options.pricingModel.formula`, replaces option placeholders, and calls `eval(formula)`.
5. Confirmed consumers include:
   - `src/components/modals/CardModal.tsx`: calls `calculateFinalPrice(order)` while deriving modal price values.
   - `src/components/modals/RatingModal.tsx`: calls it while deriving the final price for a completed trip.
   - `src/tools/order.ts::updateCompletedOrderDuration`: recalculates a completed order using the same helper; `src/state/order/sagas.ts` invokes this function after `API.getOrder`.

### Security consequence

The expression is evaluated as JavaScript in the browser page, not in a restricted arithmetic environment. A malicious or compromised formula could execute arbitrary same-origin script when one of the consumers evaluates it. This can include reading browser-accessible session data, altering the UI, issuing authenticated requests from the user's session, or transmitting accessible data to an external destination.

The source does not prove that a normal passenger can set the formula. It also does not prove that backend-side role checks, configuration controls or database constraints prevent such modification. Therefore the finding is not described as an unauthenticated exploit or as proof of a currently exploitable production path. The untrusted-data-to-code boundary must nevertheless be removed or explicitly secured.

### Required remediation

1. Remove `eval` from the pricing path. Use a small arithmetic expression parser with an explicit grammar (numeric literals, approved operators, parentheses and approved variable identifiers only).
2. Parse formula variables into a structured representation. Do not interpolate arbitrary option names or values into executable source text.
3. Validate numeric inputs and the final result (finite number, bounded precision/range); reject unsupported operators, identifiers, function calls, property access, assignments and statements.
4. Treat every order returned by the API as untrusted at the browser boundary, even if the backend is expected to generate pricing formulas.
5. If formulas are configuration-managed, validate them server-side when saved and return a structured expression/quote result to the client. Server-side validation does not justify browser `eval`.
6. Add unit tests proving that arithmetic formulas still work and that function calls, property access, assignment, statement separators, template literals and arbitrary identifiers are rejected without execution.
7. Add a regression test that a malicious formula is rejected in both CardModal and completed-order recalculation paths.

### Evidence classification

| Claim | Classification |
|---|---|
| `pricingModel.formula` is typed as a string | Observed in source |
| `getOrders` and `getOrder` convert backend booking records through `convertOrder` | Observed in source |
| `convertOrder` does not validate or sanitize the formula field | Observed in source |
| `calculateFinalPrice` calls JavaScript `eval` on the substituted formula | Observed in source |
| CardModal and RatingModal call the pricing helper | Observed in source |
| Completed-order detail loading can invoke recalculation | Observed in source |
| Ordinary passenger can set or alter `pricingModel.formula` | Unverified |
| Backend restricts formula authoring to trusted administrators | Unverified |
| A malicious formula has been observed in production | Not tested / no such evidence |
| Exploitability against a deployed tenant | Unverified |

## Test coverage

A repository search for `calculateFinalPrice` found the implementation and the two modal consumers, but no dedicated test file or test case for formula parsing, hostile input rejection or execution safety. This was a source search only; no test suite was run.

## Related security surfaces

- Stage 26 already records a separate `dangerouslySetInnerHTML` sink in `JSONFormElement.tsx`; stage 44 does not duplicate or reclassify that finding.
- The generic `HTML` component uses `react-html-parser` and is selected by the `Block` renderer's default branch. The inspected call path is through `ConstructorTab`, which is imported by the Sandbox page. Its production reachability and the trustworthiness of imported Sandbox content are not established here; no additional XSS claim is made.
- Stage 30's emulator credentials, browser emulator controls and CI trace findings remain separate.

## Pilot disposition

Do not accept the browser pricing execution path for a production pilot while an API-returned order field is evaluated as JavaScript. The minimum safe closure is removal of `eval`, constrained expression parsing, and regression tests. Backend formula-authoring permissions must be audited separately; they are not a substitute for removing this frontend execution sink.

No application source, tests, CI workflow or runtime configuration were changed.
