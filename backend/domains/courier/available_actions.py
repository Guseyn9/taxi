"""Available actions for courier snapshots.

The existing delivery UI uses button_states. Stage 1 keeps that table as the
read source and wraps it behind a domain helper.
"""

from __future__ import annotations

from typing import Dict, List

from sqlalchemy.orm import Session

from .repositories import ButtonRepository


def resolve_available_actions(
    session: Session,
    *,
    user_role: str,
    entity_state: str,
) -> List[str]:
    buttons = ButtonRepository(session).list_for_state(
        user_role=user_role,
        entity_state=entity_state,
    )
    return [button["buttonName"] for button in buttons if button["isEnabled"]]


def resolve_available_action_details(
    session: Session,
    *,
    user_role: str,
    entity_state: str,
) -> List[Dict[str, object]]:
    return ButtonRepository(session).list_for_state(
        user_role=user_role,
        entity_state=entity_state,
    )
