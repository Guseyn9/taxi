"""Taxi context builders for the FSM runtime."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Order
from .repositories import OrderRepository


def build_taxi_order_context(
    session: Session,
    *,
    entity_type: str,
    entity_id: int,
) -> Order:
    if entity_type != "order":
        raise ValueError(f"Unsupported taxi entity_type: {entity_type}")
    order = OrderRepository(session).get(entity_id, for_update=True)
    if order is None:
        raise ValueError(f"Order #{entity_id} not found")
    return order
