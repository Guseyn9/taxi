"""Courier process registration for FSM Platform.

Triggers are domain-level names. Public clients and trigger payloads must not
provide raw ``fsm_actions`` names; resolvers below own that translation.
"""

from __future__ import annotations

from fsm_core import FsmRegistry
from fsm_core.types import ProcessDef

from .context import build_courier_context
from .fsm_spec import (
    CourierActions,
    CourierEntityTypes,
    CourierLockerStates,
    CourierTripStates,
)
from .query_api import get_courier_snapshot
from .security import can_access_courier_entity


COURIER_TRIGGER_TO_ACTION = {
    CourierEntityTypes.ORDER: {
        "reserve_for_client": CourierActions.ORDER_RESERVE_FOR_CLIENT_A_TO_B,
        "reserve_for_courier": CourierActions.ORDER_RESERVE_FOR_COURIER_A_TO_B,
        "reservation_timed_out": CourierActions.ORDER_TIMEOUT_RESERVATION,
        "cancel_requested": CourierActions.ORDER_CANCEL_RESERVATION,
        "parcel_confirmed": CourierActions.ORDER_CONFIRM_PARCEL_IN,
        "parcel_submitted": CourierActions.ORDER_PARCEL_SUBMITTED,
        "courier1_assigned": CourierActions.ORDER_ASSIGN_COURIER1,
        "courier1_pickup_confirmed": CourierActions.ORDER_COURIER_PICKUP_PARCEL,
        "courier1_cancelled": CourierActions.ORDER_COURIER1_CANCEL,
        "picked_up_from_post1": CourierActions.ORDER_PICKUP_BY_DRIVER,
        "transit_started": CourierActions.ORDER_START_TRANSIT,
        "arrived_at_post2": CourierActions.ORDER_ARRIVE_AT_POST2,
        "recipient_pickup": CourierActions.ORDER_PICKUP_RECIPIENT,
        "delivery_completed": CourierActions.ORDER_DELIVERED_PARCEL,
        "courier2_assigned": CourierActions.ORDER_ASSIGN_COURIER2,
        "courier2_pickup_confirmed": CourierActions.ORDER_COURIER2_PICKUP_PARCEL,
        "courier2_delivery_confirmed": CourierActions.ORDER_COURIER2_DELIVERED_PARCEL,
        "recipient_confirmed": CourierActions.ORDER_RECIPIENT_CONFIRMED,
        "parcel_missing": CourierActions.ORDER_REPORT_PARCEL_MISSING,
        "delivery_failed": CourierActions.ORDER_REPORT_DELIVERY_FAILED,
        "manual_intervention_requested": CourierActions.ORDER_REQUEST_MANUAL_INTERVENTION,
        "no_pickup_timed_out": CourierActions.ORDER_TIMEOUT_NO_PICKUP,
    },
    CourierEntityTypes.TRIP: {
        "trip_taken": CourierActions.TRIP_TAKE_TRIP,
        "driver_assigned": CourierActions.TRIP_ASSIGN_DRIVER,
        "pickup_started": CourierActions.TRIP_START_PICKUP,
        "pickup_confirmed": CourierActions.TRIP_CONFIRM_PICKUP,
        "trip_started": CourierActions.TRIP_START_TRIP,
        "destination_arrived": CourierActions.TRIP_END_DELIVERY,
        "delivery_confirmed": CourierActions.TRIP_CONFIRM_DELIVERY,
        "trip_completed": CourierActions.TRIP_COMPLETE_TRIP,
        "driver_not_found": CourierActions.TRIP_REPORT_DRIVER_NOT_FOUND,
        "trip_failed": CourierActions.TRIP_REPORT_FAILURE,
        "manual_intervention_requested": CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION,
    },
    CourierEntityTypes.LOCKER: {
        "cell_reserved": CourierActions.LOCKER_RESERVE_CELL,
        "cell_opened": CourierActions.LOCKER_OPEN_LOCKER,
        "cell_closed": CourierActions.LOCKER_CLOSE_LOCKER,
        "pickup_closed": CourierActions.LOCKER_CLOSE_PICKUP,
        "parcel_in_confirmed": CourierActions.LOCKER_CONFIRM_PARCEL_IN,
        "parcel_not_found": CourierActions.LOCKER_CONFIRM_PARCEL_NOT_FOUND,
        "parcel_out_by_driver": CourierActions.LOCKER_CONFIRM_PARCEL_OUT,
        "parcel_out_by_recipient": CourierActions.LOCKER_CONFIRM_PARCEL_OUT_RECIPIENT,
        "cell_not_closed": CourierActions.LOCKER_DONT_CLOSED,
        "cell_reset": CourierActions.LOCKER_RESET,
        "maintenance_requested": CourierActions.LOCKER_SET_MAINTENANCE,
        "reservation_cancelled": CourierActions.LOCKER_CANCEL_RESERVATION,
    },
}


def register_courier_processes(registry: FsmRegistry) -> None:
    for entity_type in (
        CourierEntityTypes.ORDER,
        CourierEntityTypes.TRIP,
        CourierEntityTypes.LOCKER,
    ):
        registry.register_snapshot_builder(
            "courier",
            entity_type,
            build_courier_snapshot,
        )
        registry.register_access_policy(
            "courier",
            entity_type,
            can_access_courier_entity,
        )

    for process_name, entity_type in (
        ("courier_order_lifecycle", "order"),
        ("courier_trip_lifecycle", "trip"),
        ("courier_locker_lifecycle", "locker"),
    ):
        registry.register_process(
            ProcessDef(
                service="courier",
                process_name=process_name,
                entity_type=entity_type,
                context_builder=build_courier_context,
                action_resolver=resolve_courier_action,
            )
        )

    # Public integration operations resolve to these internal process names.
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="order_creation",
            entity_type=CourierEntityTypes.ORDER,
            context_builder=build_courier_context,
            action_resolver=resolve_order_creation,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="cancel_order",
            entity_type=CourierEntityTypes.ORDER,
            context_builder=build_courier_context,
            initial_action=CourierActions.ORDER_CANCEL_RESERVATION,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="assign_executor",
            entity_type=CourierEntityTypes.ORDER,
            context_builder=build_courier_context,
            action_resolver=resolve_assign_executor,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="remove_executor",
            entity_type=CourierEntityTypes.ORDER,
            context_builder=build_courier_context,
            action_resolver=resolve_remove_executor,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="confirm_courier2_delivery",
            entity_type=CourierEntityTypes.ORDER,
            context_builder=build_courier_context,
            initial_action=CourierActions.ORDER_COURIER2_DELIVERED_PARCEL,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="open_cell",
            entity_type=CourierEntityTypes.LOCKER,
            context_builder=build_courier_context,
            initial_action=CourierActions.LOCKER_OPEN_LOCKER,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="close_cell",
            entity_type=CourierEntityTypes.LOCKER,
            context_builder=build_courier_context,
            action_resolver=resolve_close_cell,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="start_trip",
            entity_type=CourierEntityTypes.TRIP,
            context_builder=build_courier_context,
            action_resolver=resolve_start_trip,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="arrive_at_destination",
            entity_type=CourierEntityTypes.TRIP,
            context_builder=build_courier_context,
            initial_action=CourierActions.TRIP_END_DELIVERY,
        )
    )
    registry.register_process(
        ProcessDef(
            service="courier",
            process_name="complete_trip",
            entity_type=CourierEntityTypes.TRIP,
            context_builder=build_courier_context,
            action_resolver=resolve_complete_trip,
        )
    )


def build_courier_snapshot(
    session,
    *,
    entity_type: str,
    entity_id: int,
    principal,
):
    return get_courier_snapshot(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        principal=principal,
    )


def resolve_courier_action(context, trigger) -> str:
    try:
        entity_actions = COURIER_TRIGGER_TO_ACTION[context.entity_type]
        return entity_actions[trigger.trigger_name]
    except KeyError as exc:
        raise ValueError(
            f"Unsupported courier trigger {trigger.trigger_name!r} "
            f"for {context.entity_type}"
        ) from exc


def resolve_order_creation(context, trigger) -> str:
    del trigger
    if context.entity.pickup_type == "self":
        return CourierActions.ORDER_RESERVE_FOR_CLIENT_A_TO_B
    if context.entity.pickup_type == "courier":
        return CourierActions.ORDER_RESERVE_FOR_COURIER_A_TO_B
    raise ValueError(f"Unsupported courier pickup_type: {context.entity.pickup_type}")


def resolve_assign_executor(context, trigger) -> str:
    del context
    leg = trigger.payload.get("leg")
    if leg == "pickup":
        return CourierActions.ORDER_ASSIGN_COURIER1
    if leg == "delivery":
        return CourierActions.ORDER_ASSIGN_COURIER2
    raise ValueError("assign_executor requires leg=pickup|delivery")


def resolve_remove_executor(context, trigger) -> str:
    del context
    leg = trigger.payload.get("leg")
    if leg == "pickup":
        return CourierActions.ORDER_COURIER1_CANCEL
    if leg == "delivery":
        return CourierActions.ORDER_COURIER2_CANCEL
    raise ValueError("remove_executor requires leg=pickup|delivery")


def resolve_close_cell(context, trigger) -> str:
    del trigger
    if context.status == CourierLockerStates.OPENED:
        return CourierActions.LOCKER_CLOSE_PICKUP
    return CourierActions.LOCKER_CLOSE_LOCKER


def resolve_start_trip(context, trigger) -> str:
    del trigger
    if context.status == CourierTripStates.ASSIGNED:
        return CourierActions.TRIP_START_PICKUP
    if context.status == CourierTripStates.PARCEL_PICKED_UP:
        return CourierActions.TRIP_START_TRIP
    raise ValueError(f"Cannot start trip from {context.status}")


def resolve_complete_trip(context, trigger) -> str:
    del trigger
    if context.status == CourierTripStates.ARRIVED_AT_DESTINATION:
        return CourierActions.TRIP_CONFIRM_DELIVERY
    if context.status in {CourierTripStates.PARCEL_DELIVERED, CourierTripStates.IN_PROGRESS}:
        return CourierActions.TRIP_COMPLETE_TRIP
    raise ValueError(f"Cannot complete trip from {context.status}")
