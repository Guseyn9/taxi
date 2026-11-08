"""Infrastructure repositories used by the FSM runtime."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from .errors import TransitionNotFound
from .serialization import json_loads_object
from .types import TransitionDef


class TransitionRepository:
    """Read declarative transition definitions without owning a transaction."""

    def get(
        self,
        session: Session,
        *,
        service: str,
        entity_type: str,
        from_state: str,
        action_name: str,
    ) -> TransitionDef:
        row = session.execute(
            text(
                """
                SELECT fs_from.name, action.name, fs_to.name,
                       t.guard_name, t.guard_params,
                       t.effect_name, t.effect_params,
                       t.timer_name, t.timer_params
                FROM fsm_transitions t
                JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
                JOIN fsm_actions action ON action.id = t.action_id
                JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
                WHERE fs_from.name = :from_state
                  AND action.name = :action_name
                  AND (t.service = :service OR t.service IS NULL)
                  AND (t.entity_type = :entity_type OR t.entity_type IS NULL)
                ORDER BY
                    CASE WHEN t.service = :service THEN 0 ELSE 1 END,
                    CASE WHEN t.entity_type = :entity_type THEN 0 ELSE 1 END
                LIMIT 1
                """
            ),
            {
                "service": service,
                "entity_type": entity_type,
                "from_state": from_state,
                "action_name": action_name,
            },
        ).fetchone()
        if not row:
            raise TransitionNotFound(f"No transition from {from_state} by {action_name}")
        return TransitionDef(
            from_state=str(row[0]),
            action_name=str(row[1]),
            to_state=str(row[2]),
            guard_name=row[3],
            guard_params=json_loads_object(row[4]),
            effect_name=row[5],
            effect_params=json_loads_object(row[6]),
            timer_name=row[7],
            timer_params=json_loads_object(row[8]),
        )
