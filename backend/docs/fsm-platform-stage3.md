# Stage 3: FSM Platform files

Stage 3 turns the Stage 1 and Stage 2 overlays into the actual multi-domain
project structure.

## Delivered

- Shared Runtime in `fsm_core`.
- Stored-procedure bridge in `fsm`.
- Courier and Taxi packages under `domains`.
- Multi-domain worker composition root in `fsm_worker.py`.
- Clean install schema and idempotent legacy migrations.
- Optimistic transition application through `expected_state`.
- Registry validation before worker startup.
- Service/entity scoping for SQL transitions.

## Deliberately deferred

- Outbox delivery and realtime/WebSocket are Stage 4.
- Timer worker remains experimental and disconnected.
- Final Courier guards/effects depend on approval of the authoritative graph.
- The old `CourierActionsFacade` remains only as a legacy migration bridge.

## Platform invariants

1. External clients send domain commands/triggers, never raw FSM action names.
2. Worker is the only owner of commit and rollback.
3. Runtime contains no Taxi or Courier business rules.
4. SQL Core does not make business decisions.
5. Effects execute only after a successful state transition and before commit.
6. External calls are not performed inside effects; Stage 4 will route them
   through outbox after commit.

