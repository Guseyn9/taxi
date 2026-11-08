"""Taxi effect functions.

Effects write local DB state only. External Core API calls should go through
core_outbox and be processed after commit.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from sqlalchemy.orm import Session

from fsm_core import EffectResult
from fsm_core.command_completion import defer_current_command_completion
from fsm_core.outbox import OutboxCompletion
from fsm_core.timers import schedule_timer

from .models import Order
from .repositories import CoreOutboxRepository, OrderRepository, TaxiTripRepository


# Internal triggers enqueued by the outbox dispatcher, never sent by clients.
DRIVER_CANCEL_CONFIRMED_TRIGGER = "driver_cancel_confirmed"
DRIVER_CANCEL_FAILED_TRIGGER = "driver_cancel_failed"
DRIVER_CANCEL_METADATA_KEY = "driver_cancel"


def create_trip(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    selected_candidate = context.metadata_json.get("selected_candidate")
    selected_offer = context.metadata_json.get("selected_offer")
    selected_driver = selected_candidate if isinstance(selected_candidate, dict) else selected_offer
    driver_user_id = (
        selected_driver.get("user_id")
        if isinstance(selected_driver, dict)
        else context.metadata_json.get("driver_user_id")
    )
    TaxiTripRepository(session).create(
        order_id=context.id,
        driver_user_id=driver_user_id,
        metadata_json=params,
    )
    return EffectResult(ok=True)


def mark_trip_started(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    del params
    TaxiTripRepository(session).mark_started(context.id)
    return EffectResult(ok=True)


def mark_trip_finished(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    TaxiTripRepository(session).mark_finished(
        order_id=context.id,
        actual_price=params.get("actual_price"),
        currency=params.get("currency"),
        outcome=str(params.get("outcome", "completed")),
    )
    return EffectResult(ok=True)


def write_core_outbox(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    """Write an external Core request into the current domain transaction."""
    event_type = str(params.get("event_type", "taxi_order_effect"))
    idempotency_key = params.get("idempotency_key")
    request_payload = params.get("request")
    if not idempotency_key:
        return EffectResult(ok=False, message="write_core_outbox requires idempotency_key")
    if not isinstance(request_payload, dict):
        return EffectResult(ok=False, message="write_core_outbox requires request payload")
    CoreOutboxRepository(session).enqueue(
        service="taxi",
        aggregate_type="order",
        aggregate_id=context.id,
        event_type=event_type,
        payload=request_payload,
        idempotency_key=str(idempotency_key),
        handler_name=str(params.get("handler_name", "core_http")),
        max_attempts=int(params.get("max_attempts", 8)),
    )
    return EffectResult(ok=True)


def request_core_driver_cancel(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    """Queue Core set_cancel_state and defer command completion until Core answers.

    ``params.previous_state`` comes from the transition row and is kept in order
    metadata so a failed Core call can return the order to that state.
    """
    previous_state = params.get("previous_state")
    if not previous_state:
        return EffectResult(ok=False, message="request_core_driver_cancel requires previous_state")
    if context.core_order_id is None:
        return EffectResult(ok=False, message=f"Order #{context.id} has no Core order mapping")

    command_instance_id = defer_current_command_completion()
    OrderRepository(session).patch_metadata(
        context.id,
        {
            DRIVER_CANCEL_METADATA_KEY: {
                "previous_state": previous_state,
                "command_instance_id": command_instance_id,
                "outcome": "pending",
            }
        },
    )
    # One Core request per accepted command: a retried command reuses the key,
    # a second command is rejected by the guard while the order is pending.
    request_key = command_instance_id if command_instance_id is not None else "direct"
    CoreOutboxRepository(session).enqueue(
        service="taxi",
        aggregate_type="order",
        aggregate_id=context.id,
        event_type="set_cancel_state",
        payload={
            "method": "POST",
            "path": f"/drive/get/{context.core_order_id}",
            "body": {"action": "set_cancel_state"},
        },
        idempotency_key=f"taxi-order-{context.id}-driver-cancel-{request_key}",
        completion=OutboxCompletion(
            process_name="taxi_order_lifecycle",
            on_sent_trigger=DRIVER_CANCEL_CONFIRMED_TRIGGER,
            on_failed_trigger=DRIVER_CANCEL_FAILED_TRIGGER,
            command_instance_id=command_instance_id,
        ),
    )
    return EffectResult(ok=True)


def finish_driver_cancel_request(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    """Record how a pending driver cancellation ended (confirmed or reverted)."""
    OrderRepository(session).patch_metadata(
        context.id,
        {DRIVER_CANCEL_METADATA_KEY: {"outcome": str(params.get("outcome", "confirmed"))}},
    )
    return EffectResult(ok=True)


def schedule_pickup_timeout(session: Session, context: Order, params: Dict[str, Any]) -> EffectResult:
    """Experimental timer effect; no timer worker is connected in Stage 3."""
    due_at = params.get("due_at")
    if isinstance(due_at, str):
        due_at_value = datetime.fromisoformat(due_at)
    elif isinstance(due_at, datetime):
        due_at_value = due_at
    else:
        return EffectResult(ok=False, message="schedule_pickup_timeout requires due_at")

    schedule_timer(
        session,
        service="taxi",
        process_name="taxi_order_lifecycle",
        entity_type="order",
        entity_id=context.id,
        timer_name="pickupWindowTimeout",
        action_name="order_no_show",
        due_at=due_at_value,
        timer_params=params,
    )
    return EffectResult(ok=True)
