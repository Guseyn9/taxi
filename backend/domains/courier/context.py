"""Context builders for courier FSM Platform processes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import CourierContext
from .repositories import CourierUnitOfWorkRepositories


def build_courier_context(session: Session, *, entity_type: str, entity_id: int) -> CourierContext:
    repositories = CourierUnitOfWorkRepositories(session)
    status, entity = repositories.get_entity_state(entity_type, entity_id)
    return CourierContext(
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
        entity=entity,
    )
