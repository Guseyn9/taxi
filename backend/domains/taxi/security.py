"""Taxi entity access rules for snapshots and realtime subscriptions."""

from __future__ import annotations

from sqlalchemy import text

from fsm_core.security import Principal
from fsm_core.serialization import json_loads_object

from .repositories import is_assigned_driver, is_order_visible_to_driver


# Commands that only the driver who took the order may send.
ASSIGNED_DRIVER_INTENTS = frozenset({"driver_cancel_requested", "driver_arrived", "ride_started", "ride_finished"})
PASSENGER_INTENTS = frozenset({"order_registered", "vote_requested", "offer_requested", "direct_assignment_requested", "cancel_requested", "candidate_selected", "candidate_released", "offer_selected"})


def can_access_taxi_entity(
    session,
    *,
    principal: Principal,
    entity_type: str,
    entity_id: int,
) -> bool:
    if principal.has_role("admin", "system"):
        return True
    if entity_type == "driver":
        return principal.has_role("driver") and principal.user_id == entity_id
    if entity_type != "order":
        return False

    row = session.execute(
        text(
            """
            SELECT m.client_local_user_id, m.performer_local_user_id,
                   o.metadata_json, o.status
            FROM orders o
            LEFT JOIN core_order_mapping m ON m.local_order_id = o.id
            WHERE o.id = :order_id
            """
        ),
        {"order_id": entity_id},
    ).fetchone()
    if row is None:
        return False

    if row[0] is not None and int(row[0]) == principal.user_id:
        return True

    metadata = json_loads_object(row[2])
    client_id = metadata.get("client_user_id") or metadata.get("passenger_user_id")
    if client_id is not None and int(client_id) == principal.user_id:
        return True
    # Drivers: the assigned driver keeps access; candidates and offer authors
    # only while the order is still searching for a driver.
    performer_id = int(row[1]) if row[1] is not None else None
    return is_order_visible_to_driver(principal.user_id, performer_id, metadata, str(row[3]))


def can_execute_taxi_order_command(
    session,
    *,
    principal: Principal,
    entity_type: str,
    entity_id: int,
    intent: str,
) -> bool:
    """Intent-level rule: some commands belong to the assigned driver only.

    Registered as the taxi/order command policy; CommandService calls it on
    accept, after can_access_taxi_entity, and answers 403 on False.
    """
    if principal.has_role("admin", "system"):
        return True
    if entity_type != "order":
        return False

    row = session.execute(
        text(
            """
            SELECT m.performer_local_user_id, o.metadata_json, m.client_local_user_id
            FROM orders o
            LEFT JOIN core_order_mapping m ON m.local_order_id = o.id
            WHERE o.id = :order_id
            FOR UPDATE
            """
        ),
        {"order_id": entity_id},
    ).fetchone()
    if row is None:
        return False
    performer_id = int(row[0]) if row[0] is not None else None
    metadata = json_loads_object(row[1])
    if intent in ASSIGNED_DRIVER_INTENTS:
        return principal.has_role("driver") and is_assigned_driver(principal.user_id, performer_id, metadata)
    if intent in PASSENGER_INTENTS:
        owner = row[2] if len(row) > 2 else metadata.get("client_user_id")
        return principal.has_role("client", "passenger") and str(owner) == str(principal.user_id)
    # System timers/reconciliation have a separate trusted entrypoint.
    return False
