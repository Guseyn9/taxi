"""Courier/domain FSM names extracted from the existing delivery engine.

This is a machine-readable contract for the current courier/postamat domain.
It does not change behavior; it names the existing states, actions and
transitions so the old delivery flow can be handled by FSM Platform pieces.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple


@dataclass(frozen=True)
class StateSpec:
    name: str
    label: Optional[str] = None


@dataclass(frozen=True)
class ActionSpec:
    name: str
    label: Optional[str] = None


@dataclass(frozen=True)
class TransitionSpec:
    entity_type: str
    action: str
    from_state: str
    to_state: str
    guard_name: Optional[str] = None
    guard_params: Optional[Dict[str, Any]] = None
    effect_name: Optional[str] = None
    effect_params: Optional[Dict[str, Any]] = None
    timer_name: Optional[str] = None
    timer_params: Optional[Dict[str, Any]] = None


class CourierEntityTypes:
    ORDER = "order"
    TRIP = "trip"
    LOCKER = "locker"


class CourierOrderStates:
    CREATED = "order_created"
    CLIENT_RESERVED_POST1_AND_POST2 = "order_client_reserved_post1_and_post2"
    COURIER_RESERVED_POST1_AND_POST2 = "order_courier_reserved_post1_and_post2"
    COURIER1_ASSIGNED = "order_courier1_assigned"
    PARCEL_SUBMITTED = "order_parcel_submitted"
    COURIER_HAS_PARCEL = "order_courier_has_parcel"
    PARCEL_CONFIRMED = "order_parcel_confirmed"
    PARCEL_CONFIRMED_POST2 = "order_parcel_confirmed_post2"
    PICKED_UP_FROM_POST1 = "order_picked_up_from_post1"
    IN_TRANSIT_TO_POST2 = "order_in_transit_to_post2"
    ARRIVED_AT_POST2 = "order_arrived_at_post2"
    DELIVERED_TO_CLIENT = "order_delivered_to_client"
    COURIER2_ASSIGNED = "order_courier2_assigned"
    COURIER2_HAS_PARCEL = "order_courier2_has_parcel"
    COURIER2_PARCEL_DELIVERED = "order_courier2_parcel_delivered"
    COMPLETED = "order_completed"
    CANCELLED = "order_cancelled"
    RESERVATION_EXPIRED = "order_reservation_expired"
    COURIER_FAILED = "order_courier_failed"
    PARCEL_MISSING = "order_parcel_missing"
    DELIVERY_FAILED = "order_delivery_failed"
    MANUAL_INTERVENTION_REQUIRED = "order_manual_intervention_required"


class CourierTripStates:
    CREATED = "trip_created"
    ASSIGNED = "trip_assigned"
    READY_FOR_PICKUP = "trip_ready_for_pickup"
    PARCEL_PICKED_UP = "trip_parcel_picked_up"
    IN_PROGRESS = "trip_in_progress"
    ARRIVED_AT_DESTINATION = "trip_arrived_at_destination"
    PARCEL_DELIVERED = "trip_parcel_delivered"
    COMPLETED = "trip_completed"
    DRIVER_NOT_FOUND = "trip_driver_not_found"
    FAILED = "trip_failed"
    MANUAL_INTERVENTION_REQUIRED = "trip_manual_intervention_required"


class CourierLockerStates:
    FREE = "locker_free"
    RESERVED = "locker_reserved"
    OPENED = "locker_opened"
    OCCUPIED = "locker_occupied"
    ERROR = "locker_error"
    MAINTENANCE = "locker_maintenance"
    CLOSED_EMPTY = "locker_closed_empty"
    PARCEL_SUBMITTED = "locker_parcel_submitted"
    PARCEL_CONFIRMED = "locker_parcel_confirmed"
    PARCEL_MISSING = "locker_parcel_missing"
    PARCEL_PICKUP_DRIVER = "locker_parcel_pickup_driver"
    PARCEL_PICKUP_RECIPIENT = "locker_parcel_pickup_recipient"


class CourierActions:
    LOCKER_RESERVE_CELL = "locker_reserve_cell"
    LOCKER_OPEN_LOCKER = "locker_open_locker"
    LOCKER_CLOSE_LOCKER = "locker_close_locker"
    LOCKER_CONFIRM_PARCEL_IN = "locker_confirm_parcel_in"
    LOCKER_RESET = "locker_reset"
    LOCKER_SET_MAINTENANCE = "locker_set_locker_to_maintenance"
    LOCKER_CONFIRM_PARCEL_NOT_FOUND = "locker_confirm_parcel_not_found"
    LOCKER_CANCEL_RESERVATION = "locker_cancel_reservation"
    LOCKER_CONFIRM_PARCEL_OUT = "locker_confirm_parcel_out"
    LOCKER_DONT_CLOSED = "locker_dont_closed"
    LOCKER_CONFIRM_PARCEL_OUT_RECIPIENT = "locker_confirm_parcel_out_recipient"
    LOCKER_CLOSE_PICKUP = "locker_close_pickup"

    TRIP_ASSIGN_DRIVER = "trip_assign_voditel"
    TRIP_START_TRIP = "trip_start_trip"
    TRIP_COMPLETE_TRIP = "trip_complete_trip"
    TRIP_START_PICKUP = "trip_start_pickup"
    TRIP_CONFIRM_PICKUP = "trip_confirm_pickup"
    TRIP_CONFIRM_DELIVERY = "trip_confirm_delivery"
    TRIP_END_DELIVERY = "trip_end_delivery"
    TRIP_REPORT_DRIVER_NOT_FOUND = "trip_report_driver_not_found"
    TRIP_REPORT_FAILURE = "trip_report_failure"
    TRIP_REQUEST_MANUAL_INTERVENTION = "trip_request_manual_intervention"
    TRIP_TAKE_TRIP = "trip_vzyat_reis"

    ORDER_TIMEOUT_RESERVATION = "order_timeout_reservation"
    ORDER_ASSIGN_COURIER1 = "order_assign_courier1_to_order"
    ORDER_TIMEOUT_CONFIRMATION = "order_timeout_confirmation"
    ORDER_CLIENT_WILL_DELIVER = "order_client_will_deliver"
    ORDER_CONFIRM_PARCEL_IN = "order_confirm_parcel_in"
    ORDER_PARCEL_SUBMITTED = "order_parcel_submitted"
    ORDER_COURIER_PICKUP_PARCEL = "order_courier_pickup_parcel"
    ORDER_CANCEL_RESERVATION = "order_cancel_reservation"
    ORDER_RESERVE_FOR_CLIENT_A_TO_B = "order_reserve_for_client_A_to_B"
    ORDER_RESERVE_FOR_COURIER_A_TO_B = "order_reserve_for_courier_A_to_B"
    ORDER_PICKUP_BY_DRIVER = "order_pickup_by_voditel"
    ORDER_START_TRANSIT = "order_start_transit"
    ORDER_ARRIVE_AT_POST2 = "order_arrive_at_post2"
    ORDER_PICKUP_RECIPIENT = "order_pickup_poluchatel"
    ORDER_DELIVERED_PARCEL = "order_delivered_parcel"
    ORDER_ASSIGN_COURIER2 = "order_assign_courier2_to_order"
    ORDER_COURIER2_PICKUP_PARCEL = "order_courier2_pickup_parcel"
    ORDER_COURIER2_DELIVERED_PARCEL = "order_courier2_delivered_parcel"
    ORDER_REPORT_PARCEL_MISSING = "order_report_parcel_missing"
    ORDER_REPORT_DELIVERY_FAILED = "order_report_delivery_failed"
    ORDER_REQUEST_MANUAL_INTERVENTION = "order_request_manual_intervention"
    ORDER_COURIER1_CANCEL = "order_courier1_cancel"
    ORDER_COURIER2_CANCEL = "order_courier2_cancel"
    ORDER_TIMEOUT_NO_PICKUP = "order_timeout_no_pickup"
    ORDER_RECIPIENT_CONFIRMED = "order_recipient_confirmed"


COURIER_STATES: Tuple[StateSpec, ...] = (
    StateSpec(CourierOrderStates.CREATED, "Order created"),
    StateSpec(CourierOrderStates.CLIENT_RESERVED_POST1_AND_POST2, "Client reserved post1 and post2"),
    StateSpec(CourierOrderStates.COURIER_RESERVED_POST1_AND_POST2, "Courier reserved post1 and post2"),
    StateSpec(CourierOrderStates.COURIER1_ASSIGNED, "Courier1 assigned"),
    StateSpec(CourierOrderStates.PARCEL_SUBMITTED, "Parcel submitted"),
    StateSpec(CourierOrderStates.COURIER_HAS_PARCEL, "Courier has parcel"),
    StateSpec(CourierOrderStates.PARCEL_CONFIRMED, "Parcel confirmed"),
    StateSpec(CourierOrderStates.PARCEL_CONFIRMED_POST2, "Parcel confirmed in post2"),
    StateSpec(CourierOrderStates.PICKED_UP_FROM_POST1, "Picked up from post1"),
    StateSpec(CourierOrderStates.IN_TRANSIT_TO_POST2, "In transit to post2"),
    StateSpec(CourierOrderStates.ARRIVED_AT_POST2, "Arrived at post2"),
    StateSpec(CourierOrderStates.DELIVERED_TO_CLIENT, "Delivered to client"),
    StateSpec(CourierOrderStates.COURIER2_ASSIGNED, "Courier2 assigned"),
    StateSpec(CourierOrderStates.COURIER2_HAS_PARCEL, "Courier2 has parcel"),
    StateSpec(CourierOrderStates.COURIER2_PARCEL_DELIVERED, "Courier2 parcel delivered"),
    StateSpec(CourierOrderStates.COMPLETED, "Order completed"),
    StateSpec(CourierOrderStates.CANCELLED, "Order cancelled"),
    StateSpec(CourierOrderStates.RESERVATION_EXPIRED, "Reservation expired"),
    StateSpec(CourierOrderStates.COURIER_FAILED, "Courier failed"),
    StateSpec(CourierOrderStates.PARCEL_MISSING, "Parcel missing"),
    StateSpec(CourierOrderStates.DELIVERY_FAILED, "Delivery failed"),
    StateSpec(CourierOrderStates.MANUAL_INTERVENTION_REQUIRED, "Manual intervention required"),
    StateSpec(CourierTripStates.CREATED, "Trip created"),
    StateSpec(CourierTripStates.ASSIGNED, "Trip assigned"),
    StateSpec(CourierTripStates.READY_FOR_PICKUP, "Trip ready for pickup"),
    StateSpec(CourierTripStates.PARCEL_PICKED_UP, "Trip parcel picked up"),
    StateSpec(CourierTripStates.IN_PROGRESS, "Trip in progress"),
    StateSpec(CourierTripStates.ARRIVED_AT_DESTINATION, "Trip arrived at destination"),
    StateSpec(CourierTripStates.PARCEL_DELIVERED, "Trip parcel delivered"),
    StateSpec(CourierTripStates.COMPLETED, "Trip completed"),
    StateSpec(CourierTripStates.DRIVER_NOT_FOUND, "Trip driver not found"),
    StateSpec(CourierTripStates.FAILED, "Trip failed"),
    StateSpec(CourierTripStates.MANUAL_INTERVENTION_REQUIRED, "Trip manual intervention required"),
    StateSpec(CourierLockerStates.FREE, "Locker free"),
    StateSpec(CourierLockerStates.RESERVED, "Locker reserved"),
    StateSpec(CourierLockerStates.OPENED, "Locker opened"),
    StateSpec(CourierLockerStates.OCCUPIED, "Locker occupied"),
    StateSpec(CourierLockerStates.ERROR, "Locker error"),
    StateSpec(CourierLockerStates.MAINTENANCE, "Locker maintenance"),
    StateSpec(CourierLockerStates.CLOSED_EMPTY, "Locker closed empty"),
    StateSpec(CourierLockerStates.PARCEL_SUBMITTED, "Locker parcel submitted"),
    StateSpec(CourierLockerStates.PARCEL_CONFIRMED, "Locker parcel confirmed"),
    StateSpec(CourierLockerStates.PARCEL_MISSING, "Locker parcel missing"),
    StateSpec(CourierLockerStates.PARCEL_PICKUP_DRIVER, "Locker parcel pickup by driver"),
    StateSpec(CourierLockerStates.PARCEL_PICKUP_RECIPIENT, "Locker parcel pickup by recipient"),
)


COURIER_ACTIONS: Tuple[ActionSpec, ...] = tuple(
    ActionSpec(value)
    for key, value in CourierActions.__dict__.items()
    if key.isupper() and isinstance(value, str)
)


ORDER_TRANSITIONS: Tuple[TransitionSpec, ...] = (
    TransitionSpec("order", CourierActions.ORDER_RESERVE_FOR_CLIENT_A_TO_B, CourierOrderStates.CREATED, CourierOrderStates.CLIENT_RESERVED_POST1_AND_POST2),
    TransitionSpec("order", CourierActions.ORDER_RESERVE_FOR_COURIER_A_TO_B, CourierOrderStates.CREATED, CourierOrderStates.COURIER_RESERVED_POST1_AND_POST2),
    TransitionSpec("order", CourierActions.ORDER_TIMEOUT_RESERVATION, CourierOrderStates.CLIENT_RESERVED_POST1_AND_POST2, CourierOrderStates.RESERVATION_EXPIRED),
    TransitionSpec("order", CourierActions.ORDER_TIMEOUT_RESERVATION, CourierOrderStates.COURIER_RESERVED_POST1_AND_POST2, CourierOrderStates.RESERVATION_EXPIRED),
    TransitionSpec("order", CourierActions.ORDER_CANCEL_RESERVATION, CourierOrderStates.CLIENT_RESERVED_POST1_AND_POST2, CourierOrderStates.CANCELLED),
    TransitionSpec("order", CourierActions.ORDER_CANCEL_RESERVATION, CourierOrderStates.COURIER_RESERVED_POST1_AND_POST2, CourierOrderStates.CANCELLED),
    TransitionSpec("order", CourierActions.ORDER_CONFIRM_PARCEL_IN, CourierOrderStates.CLIENT_RESERVED_POST1_AND_POST2, CourierOrderStates.PARCEL_CONFIRMED),
    TransitionSpec("order", CourierActions.ORDER_ASSIGN_COURIER1, CourierOrderStates.COURIER_RESERVED_POST1_AND_POST2, CourierOrderStates.COURIER1_ASSIGNED),
    TransitionSpec("order", CourierActions.ORDER_TIMEOUT_CONFIRMATION, CourierOrderStates.COURIER1_ASSIGNED, CourierOrderStates.COURIER_FAILED),
    TransitionSpec("order", CourierActions.ORDER_COURIER_PICKUP_PARCEL, CourierOrderStates.COURIER1_ASSIGNED, CourierOrderStates.COURIER_HAS_PARCEL),
    TransitionSpec("order", CourierActions.ORDER_COURIER1_CANCEL, CourierOrderStates.COURIER1_ASSIGNED, CourierOrderStates.CANCELLED),
    TransitionSpec("order", CourierActions.ORDER_CONFIRM_PARCEL_IN, CourierOrderStates.COURIER_HAS_PARCEL, CourierOrderStates.PARCEL_CONFIRMED),
    TransitionSpec("order", CourierActions.ORDER_REPORT_PARCEL_MISSING, CourierOrderStates.PARCEL_CONFIRMED, CourierOrderStates.PARCEL_MISSING),
    TransitionSpec("order", CourierActions.ORDER_REPORT_PARCEL_MISSING, CourierOrderStates.PARCEL_CONFIRMED_POST2, CourierOrderStates.PARCEL_MISSING),
    TransitionSpec("order", CourierActions.ORDER_PICKUP_BY_DRIVER, CourierOrderStates.PARCEL_SUBMITTED, CourierOrderStates.PICKED_UP_FROM_POST1),
    TransitionSpec("order", CourierActions.ORDER_START_TRANSIT, CourierOrderStates.PICKED_UP_FROM_POST1, CourierOrderStates.IN_TRANSIT_TO_POST2),
    TransitionSpec("order", CourierActions.ORDER_ARRIVE_AT_POST2, CourierOrderStates.IN_TRANSIT_TO_POST2, CourierOrderStates.ARRIVED_AT_POST2),
    TransitionSpec("order", CourierActions.ORDER_CONFIRM_PARCEL_IN, CourierOrderStates.ARRIVED_AT_POST2, CourierOrderStates.PARCEL_CONFIRMED_POST2),
    TransitionSpec("order", CourierActions.ORDER_PICKUP_RECIPIENT, CourierOrderStates.PARCEL_CONFIRMED_POST2, CourierOrderStates.DELIVERED_TO_CLIENT),
    TransitionSpec("order", CourierActions.ORDER_DELIVERED_PARCEL, CourierOrderStates.DELIVERED_TO_CLIENT, CourierOrderStates.COMPLETED),
    TransitionSpec("order", CourierActions.ORDER_ASSIGN_COURIER2, CourierOrderStates.PARCEL_CONFIRMED_POST2, CourierOrderStates.COURIER2_ASSIGNED),
    TransitionSpec("order", CourierActions.ORDER_COURIER2_PICKUP_PARCEL, CourierOrderStates.COURIER2_ASSIGNED, CourierOrderStates.COURIER2_HAS_PARCEL),
    TransitionSpec("order", CourierActions.ORDER_COURIER2_DELIVERED_PARCEL, CourierOrderStates.COURIER2_HAS_PARCEL, CourierOrderStates.COURIER2_PARCEL_DELIVERED),
    TransitionSpec("order", CourierActions.ORDER_RECIPIENT_CONFIRMED, CourierOrderStates.COURIER2_PARCEL_DELIVERED, CourierOrderStates.COMPLETED),
    TransitionSpec("order", CourierActions.ORDER_COURIER2_CANCEL, CourierOrderStates.COURIER2_ASSIGNED, CourierOrderStates.ARRIVED_AT_POST2),
    TransitionSpec("order", CourierActions.ORDER_COURIER2_CANCEL, CourierOrderStates.COURIER2_HAS_PARCEL, CourierOrderStates.ARRIVED_AT_POST2),
    TransitionSpec("order", CourierActions.ORDER_TIMEOUT_NO_PICKUP, CourierOrderStates.COURIER2_ASSIGNED, CourierOrderStates.DELIVERY_FAILED),
    TransitionSpec("order", CourierActions.ORDER_REPORT_DELIVERY_FAILED, CourierOrderStates.COURIER_HAS_PARCEL, CourierOrderStates.DELIVERY_FAILED),
    TransitionSpec("order", CourierActions.ORDER_REPORT_DELIVERY_FAILED, CourierOrderStates.IN_TRANSIT_TO_POST2, CourierOrderStates.DELIVERY_FAILED),
    TransitionSpec("order", CourierActions.ORDER_REPORT_DELIVERY_FAILED, CourierOrderStates.COURIER2_HAS_PARCEL, CourierOrderStates.DELIVERY_FAILED),
)


TRIP_TRANSITIONS: Tuple[TransitionSpec, ...] = (
    TransitionSpec("trip", CourierActions.TRIP_TAKE_TRIP, CourierTripStates.CREATED, CourierTripStates.ASSIGNED),
    TransitionSpec("trip", CourierActions.TRIP_ASSIGN_DRIVER, CourierTripStates.CREATED, CourierTripStates.ASSIGNED),
    TransitionSpec("trip", CourierActions.TRIP_START_PICKUP, CourierTripStates.ASSIGNED, CourierTripStates.READY_FOR_PICKUP),
    TransitionSpec("trip", CourierActions.TRIP_CONFIRM_PICKUP, CourierTripStates.READY_FOR_PICKUP, CourierTripStates.PARCEL_PICKED_UP),
    TransitionSpec("trip", CourierActions.TRIP_START_TRIP, CourierTripStates.PARCEL_PICKED_UP, CourierTripStates.IN_PROGRESS),
    TransitionSpec("trip", CourierActions.TRIP_END_DELIVERY, CourierTripStates.IN_PROGRESS, CourierTripStates.ARRIVED_AT_DESTINATION),
    TransitionSpec("trip", CourierActions.TRIP_CONFIRM_DELIVERY, CourierTripStates.ARRIVED_AT_DESTINATION, CourierTripStates.PARCEL_DELIVERED),
    TransitionSpec("trip", CourierActions.TRIP_COMPLETE_TRIP, CourierTripStates.PARCEL_DELIVERED, CourierTripStates.COMPLETED),
    TransitionSpec("trip", CourierActions.TRIP_COMPLETE_TRIP, CourierTripStates.IN_PROGRESS, CourierTripStates.ARRIVED_AT_DESTINATION),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_DRIVER_NOT_FOUND, CourierTripStates.CREATED, CourierTripStates.DRIVER_NOT_FOUND),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_FAILURE, CourierTripStates.CREATED, CourierTripStates.FAILED),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_FAILURE, CourierTripStates.IN_PROGRESS, CourierTripStates.FAILED),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_FAILURE, CourierTripStates.READY_FOR_PICKUP, CourierTripStates.FAILED),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_FAILURE, CourierTripStates.PARCEL_PICKED_UP, CourierTripStates.FAILED),
    TransitionSpec("trip", CourierActions.TRIP_REPORT_FAILURE, CourierTripStates.ARRIVED_AT_DESTINATION, CourierTripStates.FAILED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.CREATED, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.IN_PROGRESS, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.READY_FOR_PICKUP, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.PARCEL_PICKED_UP, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.ARRIVED_AT_DESTINATION, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
    TransitionSpec("trip", CourierActions.TRIP_REQUEST_MANUAL_INTERVENTION, CourierTripStates.PARCEL_DELIVERED, CourierTripStates.MANUAL_INTERVENTION_REQUIRED),
)


LOCKER_TRANSITIONS: Tuple[TransitionSpec, ...] = (
    TransitionSpec("locker", CourierActions.LOCKER_RESERVE_CELL, CourierLockerStates.FREE, CourierLockerStates.RESERVED),
    TransitionSpec("locker", CourierActions.LOCKER_OPEN_LOCKER, CourierLockerStates.RESERVED, CourierLockerStates.OPENED),
    TransitionSpec("locker", CourierActions.LOCKER_CLOSE_LOCKER, CourierLockerStates.PARCEL_MISSING, CourierLockerStates.CLOSED_EMPTY),
    TransitionSpec("locker", CourierActions.LOCKER_CLOSE_LOCKER, CourierLockerStates.PARCEL_CONFIRMED, CourierLockerStates.OCCUPIED),
    TransitionSpec("locker", CourierActions.LOCKER_CLOSE_LOCKER, CourierLockerStates.PARCEL_PICKUP_DRIVER, CourierLockerStates.CLOSED_EMPTY),
    TransitionSpec("locker", CourierActions.LOCKER_CLOSE_LOCKER, CourierLockerStates.PARCEL_PICKUP_RECIPIENT, CourierLockerStates.CLOSED_EMPTY),
    TransitionSpec("locker", CourierActions.LOCKER_CLOSE_PICKUP, CourierLockerStates.OPENED, CourierLockerStates.CLOSED_EMPTY),
    TransitionSpec("locker", CourierActions.LOCKER_RESET, CourierLockerStates.CLOSED_EMPTY, CourierLockerStates.FREE),
    TransitionSpec("locker", CourierActions.LOCKER_RESET, CourierLockerStates.MAINTENANCE, CourierLockerStates.FREE),
    TransitionSpec("locker", CourierActions.LOCKER_RESET, CourierLockerStates.ERROR, CourierLockerStates.FREE),
    TransitionSpec("locker", CourierActions.LOCKER_SET_MAINTENANCE, CourierLockerStates.FREE, CourierLockerStates.MAINTENANCE),
    TransitionSpec("locker", CourierActions.LOCKER_SET_MAINTENANCE, CourierLockerStates.ERROR, CourierLockerStates.MAINTENANCE),
    TransitionSpec("locker", CourierActions.LOCKER_CANCEL_RESERVATION, CourierLockerStates.RESERVED, CourierLockerStates.FREE),
    TransitionSpec("locker", CourierActions.LOCKER_CONFIRM_PARCEL_IN, CourierLockerStates.OPENED, CourierLockerStates.PARCEL_SUBMITTED),
    TransitionSpec("locker", CourierActions.LOCKER_CONFIRM_PARCEL_NOT_FOUND, CourierLockerStates.OPENED, CourierLockerStates.PARCEL_MISSING),
    TransitionSpec("locker", CourierActions.LOCKER_CONFIRM_PARCEL_OUT, CourierLockerStates.OPENED, CourierLockerStates.PARCEL_PICKUP_DRIVER),
    TransitionSpec("locker", CourierActions.LOCKER_CONFIRM_PARCEL_OUT_RECIPIENT, CourierLockerStates.OPENED, CourierLockerStates.PARCEL_PICKUP_RECIPIENT),
    TransitionSpec("locker", CourierActions.LOCKER_DONT_CLOSED, CourierLockerStates.OPENED, CourierLockerStates.ERROR),
)


COURIER_TRANSITIONS: Tuple[TransitionSpec, ...] = (
    ORDER_TRANSITIONS + TRIP_TRANSITIONS + LOCKER_TRANSITIONS
)
