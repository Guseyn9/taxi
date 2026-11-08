"""Taxi process registration for the FSM runtime."""

from __future__ import annotations

from fsm_core import FsmRegistry, ProcessDef

from .context import build_taxi_order_context
from .effects import (
    DRIVER_CANCEL_CONFIRMED_TRIGGER,
    DRIVER_CANCEL_FAILED_TRIGGER,
    DRIVER_CANCEL_METADATA_KEY,
    create_trip,
    finish_driver_cancel_request,
    mark_trip_finished,
    mark_trip_started,
    request_core_driver_cancel,
    schedule_pickup_timeout,
    write_core_outbox,
)
from .fsm_spec import DRIVER_CANCEL_REVERT_ACTIONS, TaxiFsmActions
from .models import OrderMode
from .query_api import get_driver_snapshot, get_order_snapshot
from .guards import can_cancel_order, can_driver_cancel_order, can_select_candidate, can_start_ride
from .security import can_access_taxi_entity, can_execute_taxi_order_command


def register_taxi_processes(registry: FsmRegistry) -> None:
    registry.register_snapshot_builder("taxi", "order", build_taxi_order_snapshot)
    registry.register_snapshot_builder("taxi", "driver", build_taxi_driver_snapshot)
    registry.register_access_policy("taxi", "order", can_access_taxi_entity)
    registry.register_access_policy("taxi", "driver", can_access_taxi_entity)
    registry.register_command_policy("taxi", "order", can_execute_taxi_order_command)
    registry.register_process(
        ProcessDef(
            service="taxi",
            process_name="taxi_order_creation",
            entity_type="order",
            context_builder=build_taxi_order_context,
            action_resolver=resolve_taxi_order_creation_action,
        )
    )
    registry.register_process(
        ProcessDef(
            service="taxi",
            process_name="taxi_order_lifecycle",
            entity_type="order",
            context_builder=build_taxi_order_context,
            action_resolver=resolve_taxi_order_action,
        )
    )

    registry.register_guard("can_cancel_order", can_cancel_order)
    registry.register_guard("can_driver_cancel_order", can_driver_cancel_order)
    registry.register_guard("can_select_candidate", can_select_candidate)
    registry.register_guard("can_start_ride", can_start_ride)

    registry.register_effect("create_trip", create_trip)
    registry.register_effect("mark_trip_started", mark_trip_started)
    registry.register_effect("mark_trip_finished", mark_trip_finished)
    registry.register_effect("schedule_pickup_timeout", schedule_pickup_timeout)
    registry.register_effect("write_core_outbox", write_core_outbox)
    registry.register_effect("request_core_driver_cancel", request_core_driver_cancel)
    registry.register_effect("finish_driver_cancel_request", finish_driver_cancel_request)


def build_taxi_order_snapshot(
    session,
    *,
    entity_type: str,
    entity_id: int,
    principal,
):
    if entity_type != "order":
        raise ValueError(f"Unsupported taxi snapshot entity: {entity_type}")
    return get_order_snapshot(session, entity_id, principal=principal)


def build_taxi_driver_snapshot(
    session,
    *,
    entity_type: str,
    entity_id: int,
    principal,
):
    if entity_type != "driver":
        raise ValueError(f"Unsupported taxi snapshot entity: {entity_type}")
    return get_driver_snapshot(session, entity_id, principal=principal)


def resolve_taxi_order_creation_action(context, trigger) -> str:
    if trigger.trigger_name == "order_registered" and context.mode == OrderMode.OFFER:
        return "order_register_offer"
    trigger_actions = {
        "order_registered": "order_register",
        "vote_requested": "order_publish_vote",
        "offer_requested": "order_publish_offer",
        "direct_assignment_requested": "order_assign_direct",
    }
    if trigger.trigger_name in trigger_actions:
        return trigger_actions[trigger.trigger_name]

    if context.mode == OrderMode.VOTE:
        return "order_publish_vote"
    if context.mode == OrderMode.OFFER:
        return "order_publish_offer"
    if context.mode == OrderMode.DIRECT:
        return "order_assign_direct"
    raise ValueError(f"Unsupported order mode: {context.mode}")


def resolve_taxi_order_action(context, trigger) -> str:
    if trigger.trigger_name == "driver_cancel_requested":
        return {OrderMode.VOTE: TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_VOTE, OrderMode.OFFER: TaxiFsmActions.ORDER_CANCEL_BY_DRIVER_OFFER}.get(context.mode, TaxiFsmActions.ORDER_CANCEL_BY_DRIVER)
    if trigger.trigger_name == DRIVER_CANCEL_FAILED_TRIGGER:
        return _resolve_driver_cancel_revert(context)
    mapping = {
        "cancel_requested": "order_cancel_by_client",
        "driver_cancel_requested": TaxiFsmActions.ORDER_CANCEL_BY_DRIVER,
        DRIVER_CANCEL_CONFIRMED_TRIGGER: TaxiFsmActions.ORDER_CONFIRM_DRIVER_CANCEL,
        "candidate_selected": "order_select_candidate",
        "candidate_released": "order_release_candidate",
        "offer_selected": "order_select_offer",
        "driver_arrived": "order_arrive",
        "ride_started": "order_start",
        "ride_finished": "order_finish",
        "order_expired": "order_expire",
        "pickup_timeout": "order_no_show",
        "ride_interrupted": "order_interrupt_ride",
    }
    try:
        return mapping[trigger.trigger_name]
    except KeyError as exc:
        raise ValueError(f"Unsupported taxi trigger: {trigger.trigger_name}") from exc


def _resolve_driver_cancel_revert(context) -> str:
    """Return the order to the state it was in before the driver cancelled."""
    request = context.metadata_json.get(DRIVER_CANCEL_METADATA_KEY)
    previous_state = request.get("previous_state") if isinstance(request, dict) else None
    try:
        return DRIVER_CANCEL_REVERT_ACTIONS[previous_state]
    except KeyError as exc:
        raise ValueError(
            f"Order #{context.id} has no revertible driver cancellation "
            f"(previous_state={previous_state!r})"
        ) from exc
