# Stage 25 — API failures, timeouts and recovery

## Scope and baseline

- Repository: `Guseyn9/taxi`
- Source baseline: `main` at `8cd07c90cc8c9015b8ee230c3b6821aaf2e4cddf`
- Audit branch: `audit/frontend-inventory`
- Scope: legacy API transport, FSM Command POST, Command Status polling, request deadlines, transient errors, retries, polling recovery and stale UI state.
- Findings are based on source and test definitions. No runtime/production claims are made unless explicitly stated.
- No application source changed.

## Executive result

The codebase has a substantially more deliberate recovery design for the newer FSM Command API than for the legacy API:

- FSM Command submission uses a unique command ID as an idempotency key and accepts a server-reported duplicate response.
- Command completion is polled by `instanceId`; the waiter has a 60-second default deadline.
- Transient status lookup failures (including 5xx and transport errors) are retried by the next polling cycle; 4xx and protocol errors are treated as terminal lookup failures.
- A timeout ends the local wait but does not cancel or roll back the accepted server command.

However:
- A fresh UI invocation creates a fresh command ID. The transport does not expose a way to resubmit the same ID after a lost POST response, so the idempotency mechanism is not automatically reused by a user retry.
- Legacy API requests have no visible common request timeout or retry policy in the reviewed wrapper.
- Passenger Gateway and Driver legacy event dispatch paths have no explicit deadline of their own.
- Polling loops recover from failed list reads by waiting for the next interval, but there is no exponential backoff, circuit breaker or stale-data indicator in the reviewed flow.
- A Command Status 404 is treated as terminal immediately, whereas 5xx and transport errors are retried. This assumes a 404 definitively means the instance is unknown, not temporarily unavailable/replicated late.

## 1. Legacy API transport

### 1.1 API wrapper

`src/tools/api.ts` creates FormData, reads current auth tokens from Redux and invokes the API method. It does not set an Axios timeout, AbortSignal, cancellation token or retry policy.

The reviewed `src/API/index.ts` imports Axios directly. No shared `axios.create`, `axios.defaults` or global timeout configuration was found in the searched source. Individual methods issue Axios requests; no general request deadline is evident at the wrapper boundary.

**Implication:** a stalled legacy request can remain pending for the browser/network stack's own timeout behavior. UI handlers waiting on that promise may remain in a pending state indefinitely unless their component has its own timer or is unmounted.

### 1.2 LegacyBackendGateway

`LegacyBackendGateway.observe` wraps API calls:
- validates resolved business responses using `assertSuccessfulBackendResponse`;
- publishes a correlated Completed event on success;
- normalizes errors and publishes a Failed event on rejection;
- rethrows the normalized error.

This is useful error normalization and observability, but it does not add a timeout, cancellation or retry.

`normalizeBackendError` preserves existing `BackendInteractionError`; otherwise it classifies a rejection as `BACKEND_TRANSPORT_ERROR`, extracting response data when present. It does not retain a structured Axios HTTP status/code classification in its public error code. Details are kept separately.

### 1.3 LegacyPassengerGateway and DriverMap legacy dispatch

Passenger Gateway creates a correlation ID, subscribes for a matching Completed/Failed event, dispatches a local runtime action and awaits both dispatch and response. There is no timer that rejects if the expected event is never published.

DriverMap's legacy `dispatchAndWaitForEvent` has the same pattern: it waits for a matching success/failure event and rejects if runtime dispatch itself rejects, but has no explicit deadline around the event wait.

The handlers normally publish a terminal event after their API promise settles. If an API promise never settles, or the expected event is lost/not emitted, the calling UI promise can remain pending.

## 2. FSM Command submission

`FsmTaxiCommandTransport.send`:
- creates a new `commandId` for each invocation;
- uses it as the `Idempotency-Key` header;
- includes `commandId`, `correlationId`, intent and payload in the request body;
- accepts HTTP 202 for a new command and HTTP 200 only for a duplicate;
- validates accepted/duplicate flags, positive `instanceId`, status and intent;
- converts HTTP and protocol errors to `BackendInteractionError`.

This is a strong transport contract. It is not, by itself, an automatic retry mechanism. The POST call has no AbortSignal or explicit timeout in the reviewed transport. A network rejection after the request was sent is ambiguous: the server may have accepted the command even though the client did not receive its response.

### TERM-25-01 — FSM command retry creates a new idempotency key

**Severity: High for ambiguous POST failure recovery**

**Observed:** every call to `send` calls `createId()`. The generated command ID becomes both the body command ID and Idempotency-Key. There is no caller-supplied command ID or persisted pending-command record in this transport interface. A second user invocation therefore creates a new key.

**Impact:** if the server accepted a command but the POST response was lost, manually trying the action again does not necessarily replay the original idempotency key. The server may see a distinct command. Backend state validation may reject it, but that is not equivalent to guaranteed deduplication.

**Recommendation:** expose an explicit stable command ID/idempotency key at the command-operation layer. Persist pending command identity until a definitive terminal result or read-after-ambiguous-result. A retry after an ambiguous POST must reuse the same key and exact semantic payload. Do not blindly repeat a command with a new key.

### TERM-25-02 — FSM Command POST has no explicit request deadline

**Severity: Medium**

**Observed:** `fetchRequest` is called without `signal` or timeout wrapper. The completion waiter starts only after a valid Accepted response is received.

**Impact:** the 60-second completion deadline does not cover the initial POST. If the POST hangs, the waiter is never started and the UI action promise can remain pending.

**Recommendation:** add a bounded POST deadline. On timeout, classify the result as *submission outcome unknown*, not rejected/not executed. Query by stable command ID or retry with the same idempotency key; only then present a safe recovery action.

## 3. FSM Command Status polling

### 3.1 Poll and deadline behavior

`CommandStatusDriverCommandCompletionWaiter` defaults to:
- completion deadline: 60,000 ms;
- status polling interval: 1,000 ms;
- minimum configured interval: 100 ms.

The waiter is keyed by `instanceId`; concurrent waits for the same instance return the same promise. It polls the status endpoint until COMPLETED or FAILED, or until its deadline expires.

Transient status read failures are normalized. A 4xx status error or protocol error is treated as a terminal status-lookup failure. Other errors are not settled immediately: the waiter schedules another poll at the configured fixed interval. The deadline bounds the overall wait, including a status request that never settles.

The poller does not cancel an in-flight fetch when the deadline expires. It checks that the completion is still pending when the request eventually returns, then discards the late result. This prevents a late callback from settling an already-finished waiter, but the underlying network request may still consume resources until it settles.

### TERM-25-03 — Status 404 is terminal immediately

**Severity: Medium; depends on backend contract**

**Observed:** `isTerminalStatusReadError` treats all `FSM_COMMAND_STATUS_HTTP_4xx` codes and protocol errors as terminal. A 404 therefore fails the completion wait without retry.

**Impact:** correct if 404 definitively means the accepted command instance does not exist. If the status service can be eventually consistent or temporarily return 404 after a successful acceptance, the client reports failure even though the command may later complete.

**Recommendation:** document and test the normative 404 contract. If temporary 404 is possible, treat it as transient for a bounded grace period or query the command using the stable idempotency key before failing.

### TERM-25-04 — Fixed-interval status polling, no backoff/jitter

**Severity: Low/Medium**

**Observed:** after each non-terminal result or retryable read failure, the waiter schedules the next poll at a fixed configured interval. No exponential backoff or jitter is applied.

**Impact:** many concurrent commands can synchronize status traffic. During a sustained outage, clients continue polling at the same cadence until the 60-second deadline.

**Recommendation:** consider bounded exponential backoff with jitter for transient status-read failures, while keeping the normal PENDING/PROCESSING cadence responsive. Preserve the overall deadline.

### TERM-25-05 — Completion timeout is not command cancellation

**Severity: High for UX/recovery semantics**

**Observed:** the waiter returns TIMEOUT and removes its local pending entry. It does not cancel the server command. DriverMap then throws a completion error to the UI. The command may still be processing or may have completed after the local deadline.

**Impact:** the user can interpret timeout as failure and issue a new action. A second action with a new command ID may conflict with or duplicate the still-running first command.

**Recommendation:** distinguish `COMPLETION_UNKNOWN` from a definitive command failure. After timeout, query status/read order state before enabling retry. Keep the command ID and instance ID associated with the order until reconciliation reaches a definitive state.

## 4. Order polling and Redux recovery

The orders Saga polls:
- active orders: 5 seconds;
- driver active orders: 5 seconds;
- ready orders: 3 seconds;
- history orders: 10 seconds;
- individual watched order: 5 seconds.

Android Chrome adapts these intervals upward by a factor of 1.75.

The watch Sagas wait for either SUCCESS or FAIL and then delay before the next request. Thus a failed poll does not stop the watch loop permanently; it resumes after the configured interval.

On active-orders failure, the Saga logs and dispatches GET_ACTIVE_ORDERS_FAIL. It does not dispatch an empty list in the catch path, so the last successful list is not explicitly replaced by an empty response due solely to a transient request failure. This is preferable to treating an outage as “no orders”.

The individual `getOrderSaga` catches an API error and dispatches GET_ORDER_FAIL. The reviewed `orders` reducer does not have a dedicated GET_ORDER_FAIL branch, so the failure does not overwrite the last stored `value`/ `partial` snapshot in that reducer. However, the separate `state/order` detail Saga/reducer marks its status as Fail and stores a message; the exact UI behavior depends on which store/surface is consuming the data.

### TERM-25-06 — Polling recovery has no explicit stale-data signal

**Severity: Medium**

**Observed:** list polling catches failures and dispatches FAIL; the watch loop resumes after the normal interval. The reviewed Redux order records have a `stale` field, but the poll failure path does not mark the previously successful list/order snapshot stale.

**Impact:** the last successful order list can remain visible while the backend is unreachable, without a state-level indication that the displayed information may be outdated. A user may act on an order whose server state changed on another device.

**Recommendation:** track last successful fetch time and stale/error status separately from the last known data. Keep stale data visible, but show that it is not current and prevent high-risk lifecycle actions when the order cannot be freshly reconciled.

### TERM-25-07 — Poll failures are retried at the normal cadence without backoff

**Severity: Low/Medium**

**Observed:** list and order watch loops retry by starting another request after their normal poll interval. No exponential backoff, jitter or circuit breaker is visible in these loops.

**Impact:** during a prolonged outage, many clients can continue hitting the API at regular short intervals. Active/ready polling can continue every few seconds.

**Recommendation:** add bounded backoff with jitter for repeated transport failures, reset it after a successful response, and retain the normal short cadence for successful polling.

## 5. E2E test helper retry policy — useful but not production behavior

`e2e/fixtures/taxiApi.ts` deliberately retries only connection-establishment failures (`UND_ERR_CONNECT_TIMEOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) up to three attempts. It does not retry other fetch errors or HTTP responses. The comment explicitly avoids retrying an already-sent request because the backend may have processed it.

This is a sound safety principle for the test helper, but it is not the production frontend API transport. Do not treat this E2E helper behavior as evidence that production commands have the same retry protection.

## 6. Existing test coverage

- `FsmTaxiCommandTransport.test.js`: verifies idempotency header/body, duplicate 200 acceptance, HTTP error normalization, malformed response rejection and configuration.
- `FsmCommandStatusTransport.test.js`: verifies status read, HTTP/protocol validation, rollout flag and polling interval minimum.
- `DriverCommandCompletionWaiter.test.js`: verifies COMPLETED/FAILED/TIMEOUT/CANCELLED, retry after temporary 503, timeout for pending and never-settling status requests, and fresh wait after timeout cleanup.
- `LegacyBackendGateway.test.js`: verifies normalized transport failure and HTTP-200 business-error handling.
- `LegacyPassengerGateway.test.js`: verifies normalized failed command and Passenger lifecycle mapping.
- E2E helper retry behavior is documented in `e2e/README.md`.

The tests cover important isolated contracts. They do not establish:
1. a lost FSM POST response after server acceptance followed by same-key replay;
2. a POST that never resolves;
3. a status 404 followed by eventual availability;
4. timeout followed by successful late completion and automatic UI reconciliation;
5. a production legacy API request that hangs indefinitely;
6. visible stale-data/error UX while list polling repeatedly fails;
7. safe behavior when user retries a command after an ambiguous timeout.

This stage did not execute the tests.

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| TERM-25-01 | High | FSM POST retry creates a new command ID; stable idempotency key is not reused |
| TERM-25-02 | Medium | FSM Command POST has no explicit request deadline |
| TERM-25-03 | Medium | Status 404 is treated as terminal immediately; confirm backend consistency contract |
| TERM-25-04 | Low/Medium | Fixed status polling has no backoff/jitter |
| TERM-25-05 | High | Completion timeout does not cancel command; UI must reconcile before retry |
| TERM-25-06 | Medium | Poll failures do not mark retained order data stale |
| TERM-25-07 | Low/Medium | List/order polling retries at fixed normal cadence without backoff |

## Recommended remediation order

1. **Define ambiguous-command recovery:** stable command ID, same-key replay and status/readback lookup before retry.
2. **Bound FSM POST and legacy API requests:** explicit deadlines; distinguish not-sent, rejected and outcome-unknown.
3. **Reconcile after completion timeout:** read command status and order state before enabling another lifecycle command.
4. **Expose stale state:** retain last known orders but visibly indicate stale data and last successful refresh.
5. **Add bounded backoff/jitter:** status polling and repeated list-poll failures.
6. **Add integration tests:** lost POST response, never-settling POST, eventual status availability, late completion and offline/online recovery.

## Files reviewed

- `src/tools/api.ts`
- `src/API/index.ts`
- `src/platform/adapters/backendError.ts`
- `src/platform/adapters/LegacyBackendGateway.ts`
- `src/platform/adapters/LegacyPassengerGateway.ts`
- `src/platform/adapters/FsmTaxiCommandTransport.ts`
- `src/platform/adapters/FsmCommandStatusTransport.ts`
- `src/platform/adapters/DriverCommandCompletionWaiter.ts`
- `src/platform/adapters/DriverMapGateway.ts`
- `src/state/orders/actionCreators.ts`
- `src/state/orders/sagas.ts`
- `src/state/orders/reducer.ts`
- `src/state/order/sagas.ts`
- `src/platform/adapters/__tests__/FsmTaxiCommandTransport.test.js`
- `src/platform/adapters/__tests__/FsmCommandStatusTransport.test.js`
- `src/platform/adapters/__tests__/DriverCommandCompletionWaiter.test.js`
- `src/platform/adapters/__tests__/LegacyBackendGateway.test.js`
- `src/platform/adapters/__tests__/LegacyPassengerGateway.test.js`
- `e2e/fixtures/taxiApi.ts`
- `e2e/README.md`

## Limitations

- No Jest, TypeScript, build or Playwright execution was performed in this stage.
- No live network interruption or backend outage was induced.
- No production API latency/timeout measurements were collected.
- No backend idempotency-store retention or status-service consistency guarantees were inspected.
- No assumption is made that a rejected/timed-out client request means the server did not execute it.
- All source conclusions refer to the pinned `main` commit above.
