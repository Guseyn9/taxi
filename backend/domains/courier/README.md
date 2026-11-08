# Courier Domain Package

This package is stage 1 of moving the current delivery/courier implementation
to FSM Platform.

The goal of this stage is to make the courier/postamat process explicit as a
domain package beside `domains/taxi`. The seed is a proposed machine graph and
must be compared with the authoritative production dump before deployment;
local historical dumps contain legacy transitions that differ from this graph.

## What Is Included

- `fsm_spec.py` - machine-readable state/action/transition names extracted from
  the current delivery FSM.
- `sql/courier_fsm_seed.sql` - idempotent MySQL seed for the existing
  table-driven FSM engine.
- `repositories.py` - repository layer over existing tables:
  `orders`, `trips`, `stage_orders`, `locker_cells`, `button_states`.
- `actions.py` - thin facade over existing `fsm_perform_action` names.
- `processes.py` - FSM Platform process registration for order/trip/locker.
- `query_api.py` - snapshot helper for future Domain API handlers.
- `available_actions.py` - read wrapper around existing `button_states`.

## Boundaries

The package does not own transactions. Workers own sessions, commits and
rollbacks.

The package does not introduce a new event layer.

The package does not move locker hardware effects out of the current stored
procedure yet.

Public clients do not pass raw FSM action names. Domain trigger names and
integration process names are translated to internal `fsm_actions` by the
registered `ProcessDef` resolvers.

The package keeps current entity types:

- `order`
- `trip`
- `locker`

## Process Names

- `courier_order_lifecycle`
- `courier_trip_lifecycle`
- `courier_locker_lifecycle`

The integration contract aliases `order_creation`, `cancel_order`,
`assign_executor`, `remove_executor`, `confirm_courier2_delivery`, `open_cell`,
`close_cell`, `start_trip`, `arrive_at_destination` and `complete_trip` are also
registered for the worker boundary.

## Next Step

After this package is reviewed, the old FastAPI endpoints and `db_layer.py`
methods can be gradually routed through `CourierActionsFacade`,
`get_courier_snapshot` and the shared `fsm_core` workers.
