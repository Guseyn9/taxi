"""Read-side helpers for Domain API handlers.

This module is intentionally framework-free. A REST/SSE/WS adapter can call
these functions and serialize the returned dictionaries as the Domain API
snapshot.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import os
from fsm_core.invocations import sync_status

from sqlalchemy.orm import Session

from fsm_core.security import Principal

from .available_actions import resolve_available_actions, resolve_driver_available_actions
from .fsm_spec import TaxiFsmStates
from .models import Order, OrderStatus
from .repositories import OrderRepository


READY_STATES = {
    OrderStatus.VOTE_WAITING_CANDIDATES.value,
    OrderStatus.OFFER_WAITING.value,
}
ACTIVE_STATES = {
    OrderStatus.VOTE_DRIVER_ASSIGNED.value,
    OrderStatus.DRIVER_ASSIGNED.value,
    OrderStatus.DRIVER_ARRIVED.value,
    OrderStatus.IN_RIDE.value,
    # Waiting for Core to confirm the driver's cancellation; no driver actions.
    OrderStatus.DRIVER_CANCEL_PENDING.value,
}
HISTORY_STATES = {
    OrderStatus.COMPLETED.value,
    OrderStatus.CANCELLED.value,
    OrderStatus.EXPIRED.value,
    OrderStatus.VOTE_NO_SHOW.value,
    OrderStatus.RIDE_INTERRUPTED.value,
}
CURRENT_TRIP_PRIORITY = (
    TaxiFsmStates.ORDER_IN_RIDE,
    TaxiFsmStates.ORDER_DRIVER_ARRIVED,
    TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
    TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING,
)


def get_order_snapshot(
    session: Session,
    order_id: int,
    *,
    principal: Principal,
) -> Dict[str, Any]:
    order = OrderRepository(session).get(order_id)
    if order is None:
        raise ValueError(f"Order #{order_id} not found")
    snapshot = _order_snapshot(order, principal=principal)
    return _with_sync(session, order.id, snapshot)


def get_driver_snapshot(
    session: Session,
    driver_user_id: int,
    *,
    principal: Principal,
) -> Dict[str, Any]:
    orders = OrderRepository(session).list_visible_to_driver(driver_user_id)
    ready_orders: List[Dict[str, Any]] = []
    active_orders: List[Dict[str, Any]] = []
    history_orders: List[Dict[str, Any]] = []

    for order in orders:
        card = _with_sync(session, order.id, _driver_order_card(order, principal=principal))
        if card['state'] in READY_STATES:
            ready_orders.append(card)
        elif card['state'] in ACTIVE_STATES:
            active_orders.append(card)
        elif card['state'] in HISTORY_STATES:
            history_orders.append(card)

    current_trip = _current_trip(active_orders)
    available_actions = list(current_trip["availableActions"]) if current_trip else []
    return {
        "driverUserId": driver_user_id,
        "driver": {
            "user": {"userId": driver_user_id},
            "readyOrders": ready_orders,
            "activeOrders": active_orders,
            "historyOrders": history_orders,
            "currentTrip": current_trip,
        },
        "availableActions": available_actions,
    }


def get_available_actions_snapshot(
    session: Session,
    order_id: int,
    *,
    principal: Principal,
) -> Dict[str, Any]:
    snapshot = get_order_snapshot(session, order_id, principal=principal)
    return {
        "orderId": snapshot["orderId"],
        "state": snapshot["state"],
        "mode": snapshot["mode"],
        "availableActions": snapshot["availableActions"],
    }


def _order_snapshot(order: Order, *, principal: Principal) -> Dict[str, Any]:
    metadata = dict(order.metadata_json)
    is_privileged = principal.has_role("admin", "system", "client", "passenger")
    candidates = metadata.get("candidates", [])
    offers = metadata.get("offers", [])
    if not is_privileged:
        candidates = _only_principal_entries(candidates, principal.user_id)
        offers = _only_principal_entries(offers, principal.user_id)

    snapshot = {
        "orderId": order.id,
        "coreOrderId": order.core_order_id,
        "state": order.status,
        "mode": order.mode.value,
        "bState": order.b_state,
        "description": order.description,
        "booking": metadata.get("booking"),
        "availableActions": resolve_available_actions(
            order.status,
            user_role=principal.primary_role,
        ),
        "candidates": candidates,
        "offers": offers,
        "selectedCandidate": _selected_for_principal(
            metadata.get("selected_candidate"), principal, is_privileged
        ),
        "selectedOffer": _selected_for_principal(
            metadata.get("selected_offer"), principal, is_privileged
        ),
        "driver": metadata.get("driver"),
        "price": metadata.get("price"),
        "payment": metadata.get("payment"),
    }
    if principal.has_role("admin", "system"):
        snapshot["metadata"] = metadata
    return snapshot


def _driver_order_card(order: Order, *, principal: Principal) -> Dict[str, Any]:
    metadata = dict(order.metadata_json)
    historical_cancel = principal.user_id in metadata.get('cancelled_driver_user_ids', []) and str(metadata.get('driver_user_id')) != str(principal.user_id)
    return {
        "orderId": order.id,
        "coreOrderId": order.core_order_id,
        "state": 'order_cancelled' if historical_cancel else order.status,
        "mode": order.mode.value,
        "bState": order.b_state,
        "description": order.description,
        "booking": metadata.get("booking"),
        "ownDriver": metadata.get("driver_records", {}).get(str(principal.user_id)),
        "price": metadata.get("price"),
        "availableActions": [] if historical_cancel else resolve_driver_available_actions(
            order.status,
            user_role=principal.primary_role,
        ),
    }


def _current_trip(active_orders: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    by_state = {item["state"]: item for item in active_orders}
    for state in CURRENT_TRIP_PRIORITY:
        if state in by_state:
            return by_state[state]
    return active_orders[0] if active_orders else None


def _only_principal_entries(items, user_id: int):
    return [
        item
        for item in items
        if isinstance(item, dict) and str(item.get("user_id")) == str(user_id)
    ]


def _selected_for_principal(value, principal: Principal, privileged: bool):
    if privileged:
        return value
    if not isinstance(value, dict):
        return None
    return value if str(value.get("user_id")) == str(principal.user_id) else None


def _with_sync(session, order_id, snapshot):
    if os.getenv("FSM_EXTERNAL_SYNC_ENABLED", "1") == "1":
        snapshot["sync"] = sync_status(session, "taxi", "order", order_id)
        if snapshot["sync"]["status"] != "idle":
            snapshot["availableActions"] = []
    return snapshot
