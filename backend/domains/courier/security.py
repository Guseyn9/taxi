"""Courier entity access rules for snapshots and realtime subscriptions."""

from __future__ import annotations

from sqlalchemy import text

from fsm_core.security import Principal


def can_access_courier_entity(
    session,
    *,
    principal: Principal,
    entity_type: str,
    entity_id: int,
) -> bool:
    if principal.has_role("admin", "system"):
        return True

    if entity_type == "order":
        row = session.execute(
            text(
                """
                SELECT 1
                FROM stage_orders
                WHERE order_id = :entity_id
                  AND (
                      courier1_user_id = :user_id
                      OR courier2_user_id = :user_id
                  )
                LIMIT 1
                """
            ),
            {"entity_id": entity_id, "user_id": principal.user_id},
        ).fetchone()
        return row is not None

    if entity_type == "trip":
        row = session.execute(
            text(
                """
                SELECT 1 FROM trips
                WHERE id = :entity_id AND driver_user_id = :user_id
                """
            ),
            {"entity_id": entity_id, "user_id": principal.user_id},
        ).fetchone()
        return row is not None

    if entity_type == "locker":
        row = session.execute(
            text(
                """
                SELECT 1 FROM locker_cells
                WHERE id = :entity_id AND reserved_for_user_id = :user_id
                """
            ),
            {"entity_id": entity_id, "user_id": principal.user_id},
        ).fetchone()
        return row is not None

    return False
