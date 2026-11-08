# Taxi Domain Package

This package is the taxi-specific domain layer on top of the existing
table-driven MySQL FSM.

## Boundaries

- The worker creates/closes the SQLAlchemy `Session`.
- The worker performs `commit()` / `rollback()`.
- Repositories and actions only use the session they receive.
- Repositories and actions never create, commit, roll back, or close sessions.
- `fsm_perform_action()` is called through the current session connection via
  `cursor.callproc()`.

## Layers

- `models.py` contains domain models: `Order`, `Candidate`, `Offer`, `Ride`,
  `Incident`.
- `repositories.py` contains the thin ORM/repository layer.
- `actions.py` contains orchestration actions for order lifecycle.
- `intents.py` maps external Command API intents to ProcessDef triggers.
- `core_adapter.py` defines the external core/iBronevik adapter contract.
- `fsm_spec.py` lists taxi FSM action/state names and expected transitions.
- `sql/taxi_order_fsm_seed.sql` adds the missing taxi FSM rows to
  `fsm_states`, `fsm_actions` and `fsm_transitions`.

## Order Actions

The current action layer covers:

- `order_create`
- `order_publish_vote`
- `order_select_candidate`
- `order_release_candidate`
- `order_assign_direct`
- `order_publish_offer`
- `driver_set_offer`
- `order_select_offer`
- `order_cancel`
- `order_arrive`
- `order_start`
- `order_finish`
- `order_no_show`
- `order_expire`
- `order_interrupt_ride`

`order_select_candidate`, `order_assign_direct` and `order_select_offer` call
core `set_performer`. `driver_set_offer` calls core `set_offer`. The procedure
transition is still performed through `fsm_perform_action`.

These direct calls belong to the legacy `TaxiOrderActions` bridge. New
ProcessDef/effect implementations must write Core requests through
`write_core_outbox`; `OutboxDispatcher` performs the HTTP call after commit.
Final operation paths and payloads depend on the approved Core API contract.

## Database Seed

The previous Vote dump already contains the basic Vote path:

- `order_created -> order_vote_waiting_candidates`
- `order_vote_waiting_candidates -> order_vote_driver_assigned`
- `order_vote_driver_assigned -> order_vote_waiting_candidates`
- `order_vote_driver_assigned -> order_cancelled`
- `order_vote_driver_assigned -> order_vote_no_show`

`sql/taxi_order_fsm_seed.sql` keeps those names and adds Direct, Offer and ride
lifecycle transitions. It is a seed/migration for the FSM database, not the full
database dump.

## MVP Storage

`Candidate` and `Offer` are stored inside `orders.metadata_json` for now:

- `metadata_json.candidates[]`
- `metadata_json.offers[]`
- `metadata_json.selected_candidate`
- `metadata_json.selected_offer`

If analytics, auction history, or separate candidate/offer lifecycles become
necessary, they can be moved to dedicated tables later.
