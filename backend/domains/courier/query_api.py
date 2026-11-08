"""Read-side helpers for courier Domain API handlers."""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy.orm import Session

from fsm_core.security import Principal

from .available_actions import resolve_available_actions
from .repositories import CourierOrderRepository, CourierTripRepository, LockerRepository


def get_courier_snapshot(
    session: Session,
    *,
    entity_type: str,
    entity_id: int,
    principal: Principal,
) -> Dict[str, Any]:
    if entity_type == "order":
        entity = CourierOrderRepository(session).get(entity_id)
        payload = _order_payload(entity)
    elif entity_type == "trip":
        entity = CourierTripRepository(session).get(entity_id)
        payload = _trip_payload(entity)
    elif entity_type == "locker":
        entity = LockerRepository(session).get_cell(entity_id)
        payload = _locker_payload(entity)
    else:
        raise ValueError(f"Unsupported courier entity_type: {entity_type}")

    if entity is None:
        raise ValueError(f"{entity_type} #{entity_id} not found")

    payload["availableActions"] = (
        resolve_available_actions(
            session,
            user_role=principal.primary_role,
            entity_state=entity.status,
        )
        if principal.primary_role
        else []
    )
    if not principal.has_role("admin", "system"):
        payload.pop("reservedForUserId", None)
    return payload


def _order_payload(entity) -> Dict[str, Any]:
    if entity is None:
        return {}
    return {
        "entityType": "order",
        "id": entity.id,
        "state": entity.status,
        "description": entity.description,
        "pickupType": entity.pickup_type,
        "deliveryType": entity.delivery_type,
        "fromCity": entity.from_city,
        "toCity": entity.to_city,
        "sourceCellId": entity.source_cell_id,
        "destCellId": entity.dest_cell_id,
    }


def _trip_payload(entity) -> Dict[str, Any]:
    if entity is None:
        return {}
    return {
        "entityType": "trip",
        "id": entity.id,
        "state": entity.status,
        "active": entity.active,
        "fromCity": entity.from_city,
        "toCity": entity.to_city,
        "driverUserId": entity.driver_user_id,
        "description": entity.description,
    }


def _locker_payload(entity) -> Dict[str, Any]:
    if entity is None:
        return {}
    return {
        "entityType": "locker",
        "id": entity.id,
        "state": entity.status,
        "lockerId": entity.locker_id,
        "cellCode": entity.cell_code,
        "cellType": entity.cell_type,
        "currentOrderId": entity.current_order_id,
        "reservedForUserId": entity.reserved_for_user_id,
    }
