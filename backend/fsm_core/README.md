# FSM Platform

`fsm_core` is a domain-neutral Runtime around the MySQL table-driven FSM.

## Execution pipeline

```text
Worker transaction
  -> ProcessDef
  -> Context Builder (SELECT ... FOR UPDATE)
  -> Action Resolver
  -> Transition lookup
  -> Guard
  -> SQL Core v2 (conditional UPDATE by expected_state)
  -> rebuild post-transition Context
  -> Effect
  -> Worker COMMIT or ROLLBACK
```

Responsibilities are intentionally strict:

- Worker owns `Session`, `COMMIT` and `ROLLBACK`.
- Context Builder reads and locks the domain context.
- Domain resolver and guard make business decisions.
- SQL Core applies an already selected transition atomically and logs it.
- Effect receives the rebuilt context with the new state and changes local
  data in the same transaction.
- SQL Core does not read business data to make decisions.

## Installation

Existing project database:

1. Apply `sql/002_fsm_instance_worker.sql`.
2. Apply `sql/003_fsm_platform.sql`.
3. Apply Courier and Taxi domain seeds after their graphs are approved.
4. Apply `sql/004_scope_domain_transitions.sql`.

Clean database:

1. Apply `sql/install_fsm_platform.sql`.
2. Apply `sql/003_fsm_platform.sql` to install SQL Core v2 and bindings.
3. Create domain tables and apply domain seeds.
4. Apply `sql/004_scope_domain_transitions.sql`.

`003_fsm_platform.sql` is idempotent. Its DDL is not wrapped in a transaction
because MySQL commits DDL implicitly.

## Concurrency contract

Runtime passes `expected_state` to `fsm_perform_action_v2`. SQL Core performs:

```sql
UPDATE domain_table
SET status = :new_state
WHERE id = :entity_id
  AND status = :expected_state;
```

Zero updated rows returns `TRANSITION_CONFLICT`. SQL Core does not commit or
roll back. Legacy `fsm_perform_action` remains available only while old facades
are being migrated.

## Startup validation

The composition root registers all processes, guards and effects, then calls
`FsmRegistry.validate_database()`. Startup fails when a referenced guard,
effect or active process is not registered, or when scoped transitions are
ambiguous.

## Stage 4 infrastructure

`outbox.py` implements post-commit at-least-once delivery. Network handlers do
not receive a Session and run only after the claim transaction is committed.

`realtime.py` stores transition events transactionally and publishes committed
events through the `RealtimeTransport` contract. `InMemoryRealtimeHub` supports
one API process; `RedisRealtimeHub` supports multiple processes and nodes.
`realtime_api.py` exposes authenticated snapshots, replay and WebSocket
updates. Snapshot builders run through `SnapshotService` with a read-only
Session and entity-level access policy.

Every call to `enqueue_instance_trigger()` appends a separate worker task.
Concurrent commands cannot overwrite each other; stale commands are rejected
later by SQL Core through `expected_state`.

`command_api.py` exposes authenticated HTTP intents. Clients send external
`intent` names (never raw FSM actions). The adapter opens a Session, authenticates
a Principal, checks entity access policy, resolves the domain IntentCatalog,
appends a worker task through `enqueue_fsm_instance`, then commits and closes
the Session. `CommandService` does not own the transaction. Idempotency is
stored in `fsm_command_idempotency` (`sql/006_command_api.sql`).

See `docs/fsm-platform-stage4.md` for the wire contract and
`docs/fsm-platform-lifecycle.md` for the complete execution lifecycle.

The timer worker remains experimental. Domain-specific Courier effects still
depend on approval of the authoritative Courier transition graph.
