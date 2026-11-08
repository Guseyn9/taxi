"""Courier domain action facade.

This layer keeps the old action names but places them behind the domain package.
It does not own transactions and does not create sessions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from fsm import FsmProcedureResult

from .fsm_spec import CourierActions, CourierEntityTypes
from .repositories import CourierTripRepository, FsmTransitionRepository


@dataclass(frozen=True)
class CourierActionResult:
    entity_type: str
    entity_id: int
    action_name: str
    fsm_message: Optional[str] = None


class CourierActionsFacade:
    def __init__(self, session: Session):
        self.session = session
        self.fsm = FsmTransitionRepository(session)
        self.trips = CourierTripRepository(session)

    def perform(
        self,
        *,
        entity_type: str,
        entity_id: int,
        action_name: str,
        user_id: int,
        extra_id: Optional[str] = None,
    ) -> CourierActionResult:
        result = self.fsm.transition(entity_type, entity_id, action_name, user_id, extra_id)
        return self._result(entity_type, entity_id, action_name, result)

    def start_order_flow(self, *, order_id: int, pickup_type: str, user_id: int) -> CourierActionResult:
        if pickup_type == "self":
            action_name = CourierActions.ORDER_RESERVE_FOR_CLIENT_A_TO_B
        elif pickup_type == "courier":
            action_name = CourierActions.ORDER_RESERVE_FOR_COURIER_A_TO_B
        else:
            raise ValueError(f"Unsupported pickup_type: {pickup_type}")
        return self.perform(
            entity_type=CourierEntityTypes.ORDER,
            entity_id=order_id,
            action_name=action_name,
            user_id=user_id,
        )

    def assign_order_to_trip(self, *, order_id: int, trip_id: int) -> None:
        self.trips.assign_order(trip_id=trip_id, order_id=order_id)

    def set_courier1(self, *, order_id: int, courier_id: int) -> None:
        self.trips.set_courier1(order_id=order_id, courier_id=courier_id)

    def set_courier2(self, *, order_id: int, courier_id: int) -> None:
        self.trips.set_courier2(order_id=order_id, courier_id=courier_id)

    def assign_courier1_to_order(self, *, order_id: int, courier_id: int) -> CourierActionResult:
        self.set_courier1(order_id=order_id, courier_id=courier_id)
        return self.perform(
            entity_type=CourierEntityTypes.ORDER,
            entity_id=order_id,
            action_name=CourierActions.ORDER_ASSIGN_COURIER1,
            user_id=courier_id,
        )

    def assign_courier2_to_order(self, *, order_id: int, courier_id: int) -> CourierActionResult:
        self.set_courier2(order_id=order_id, courier_id=courier_id)
        return self.perform(
            entity_type=CourierEntityTypes.ORDER,
            entity_id=order_id,
            action_name=CourierActions.ORDER_ASSIGN_COURIER2,
            user_id=courier_id,
        )

    def _result(
        self,
        entity_type: str,
        entity_id: int,
        action_name: str,
        procedure_result: FsmProcedureResult,
    ) -> CourierActionResult:
        return CourierActionResult(
            entity_type=entity_type,
            entity_id=entity_id,
            action_name=action_name,
            fsm_message=procedure_result.message,
        )
