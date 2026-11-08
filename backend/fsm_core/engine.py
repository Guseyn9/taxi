"""FSM runtime entry point.

The worker owns the SQLAlchemy session and transaction boundary. This runtime
uses the provided session only.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from .registry import FsmRegistry
from .transition_runner import TransitionRunner
from .types import FsmResult, TransitionEventRecorder, Trigger


class FsmEngine:
    def __init__(
        self,
        registry: FsmRegistry,
        *,
        transition_event_recorder: Optional[TransitionEventRecorder] = None,
    ):
        self.registry = registry
        self.runner = TransitionRunner(
            registry,
            transition_event_recorder=transition_event_recorder,
        )

    def run_action(
        self,
        session: Session,
        *,
        service: str,
        process_name: str,
        entity_type: str,
        entity_id: int,
        trigger: Trigger,
        user_id: int,
        extra_id: Optional[str] = None,
    ) -> FsmResult:
        return self.runner.run(
            session,
            service=service,
            process_name=process_name,
            entity_type=entity_type,
            entity_id=entity_id,
            trigger=trigger,
            user_id=user_id,
            extra_id=extra_id,
        )
