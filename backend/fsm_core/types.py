"""Shared types for the FSM runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Dict, Optional, Protocol

from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from .security import Principal


@dataclass(frozen=True)
class Trigger:
    trigger_type: str
    trigger_name: str
    payload: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GuardResult:
    ok: bool
    reason: Optional[str] = None


@dataclass(frozen=True)
class EffectResult:
    ok: bool = True
    message: Optional[str] = None


@dataclass(frozen=True)
class FsmResult:
    ok: bool
    action_name: Optional[str] = None
    from_state: Optional[str] = None
    to_state: Optional[str] = None
    message: Optional[str] = None
    result_code: str = "OK"


@dataclass(frozen=True)
class TransitionDef:
    action_name: str
    from_state: str
    to_state: str
    guard_name: Optional[str] = None
    guard_params: Dict[str, Any] = field(default_factory=dict)
    effect_name: Optional[str] = None
    effect_params: Dict[str, Any] = field(default_factory=dict)
    timer_name: Optional[str] = None
    timer_params: Dict[str, Any] = field(default_factory=dict)


class ContextBuilder(Protocol):
    def __call__(self, session: Session, *, entity_type: str, entity_id: int) -> Any:
        ...


class ActionResolver(Protocol):
    def __call__(self, context: Any, trigger: Trigger) -> str:
        ...


class SnapshotBuilder(Protocol):
    """Build a snapshot using a caller-owned read-only session.

    Implementations must not flush, commit, roll back, or mutate domain data.
    The SnapshotService always rolls the session back before closing it.
    """

    def __call__(
        self,
        session: Session,
        *,
        entity_type: str,
        entity_id: int,
        principal: "Principal",
    ) -> Dict[str, Any]:
        ...


GuardFn = Callable[[Session, Any, Dict[str, Any]], GuardResult]
EffectFn = Callable[[Session, Any, Dict[str, Any]], EffectResult]
TransitionEventRecorder = Callable[..., int]


@dataclass(frozen=True)
class ProcessDef:
    service: str
    process_name: str
    entity_type: str
    context_builder: ContextBuilder
    initial_action: Optional[str] = None
    action_resolver: Optional[ActionResolver] = None

    def resolve_action(self, context: Any, trigger: Trigger) -> str:
        if self.action_resolver is not None:
            return self.action_resolver(context, trigger)
        if self.initial_action is not None:
            return self.initial_action
        raise ValueError(f"Process {self.service}/{self.process_name} has no action resolver")
