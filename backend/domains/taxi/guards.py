"""Taxi guard functions.

Guard names follow the can_* convention and are registered in processes.py.
"""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy.orm import Session

from fsm_core import GuardResult

from .fsm_spec import DRIVER_CANCELLABLE_STATES, TaxiFsmStates
from .models import Order


def can_cancel_order(session: Session, context: Order, params: Dict[str, Any]) -> GuardResult:
    del session, params
    if context.status == TaxiFsmStates.ORDER_IN_RIDE:
        return GuardResult(ok=False, reason="Cannot cancel an order after ride start")
    if context.status in {
        TaxiFsmStates.ORDER_COMPLETED,
        TaxiFsmStates.ORDER_CANCELLED,
        TaxiFsmStates.ORDER_EXPIRED,
        TaxiFsmStates.RIDE_INTERRUPTED,
        TaxiFsmStates.ORDER_VOTE_NO_SHOW,
    }:
        return GuardResult(ok=False, reason="Cannot cancel terminal order")
    return GuardResult(ok=True)


def can_driver_cancel_order(session: Session, context: Order, params: Dict[str, Any]) -> GuardResult:
    """The assigned driver may cancel only a taken order before the ride starts.

    That the requester is the assigned driver is checked when the command is
    accepted (security.can_execute_taxi_order_command); guards do not see the
    requester.
    """
    del session, params
    if context.status in DRIVER_CANCELLABLE_STATES:
        return GuardResult(ok=True)
    if context.status == TaxiFsmStates.ORDER_IN_RIDE:
        return GuardResult(ok=False, reason="Cannot cancel an order after ride start")
    return GuardResult(
        ok=False,
        reason=f"Driver can cancel only a taken order; current state is {context.status}",
    )


def can_start_ride(session: Session, context: Order, params: Dict[str, Any]) -> GuardResult:
    del session, params
    if context.status != TaxiFsmStates.ORDER_DRIVER_ARRIVED:
        return GuardResult(ok=False, reason="Ride can start only after driver arrival")
    return GuardResult(ok=True)


def can_select_candidate(session: Session, context: Order, params: Dict[str, Any]) -> GuardResult:
    del session, params
    if context.status != TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES:
        return GuardResult(ok=False, reason="Candidate can be selected only while vote is open")
    return GuardResult(ok=True)
