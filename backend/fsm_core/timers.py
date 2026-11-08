"""Experimental timer helpers for future FSM Platform stages.

These helpers are not connected to the Stage 3 composition root. Timers will
produce domain triggers rather than change entity state directly when enabled.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .serialization import json_dumps

def schedule_timer(
    session: Session,
    *,
    service: str,
    process_name: str,
    entity_type: str,
    entity_id: int,
    timer_name: str,
    action_name: str,
    due_at: datetime,
    timer_params: Optional[Dict[str, Any]] = None,
) -> int:
    session.execute(
        text(
            """
            INSERT INTO fsm_timers (
                service, process_name, entity_type, entity_id,
                timer_name, timer_params, action_name, due_at
            )
            VALUES (
                :service, :process_name, :entity_type, :entity_id,
                :timer_name, :timer_params, :action_name, :due_at
            )
            """
        ),
        {
            "service": service,
            "process_name": process_name,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "timer_name": timer_name,
            "timer_params": json_dumps(timer_params or {}),
            "action_name": action_name,
            "due_at": due_at,
        },
    )
    row = session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
    return int(row[0]) if row and row[0] else 0


def cancel_timer(session: Session, *, timer_id: int) -> None:
    session.execute(
        text("UPDATE fsm_timers SET status = 'CANCELLED' WHERE id = :timer_id"),
        {"timer_id": timer_id},
    )
