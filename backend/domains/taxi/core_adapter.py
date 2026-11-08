"""Core/iBronevik adapter contract for taxi actions.

The actual HTTP implementation is intentionally not created here. Actions depend
on this small contract so the worker can inject a real adapter or a test double.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Protocol


@dataclass(frozen=True)
class CoreOrderResult:
    core_order_id: Optional[int]
    b_state: Optional[int] = None
    payload: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class CoreActionResult:
    ok: bool
    b_state: Optional[int] = None
    payload: Dict[str, Any] = field(default_factory=dict)


class CoreAdapter(Protocol):
    def create_order(self, payload: Dict[str, Any]) -> CoreOrderResult:
        ...

    def set_confirm_state(
        self,
        core_order_id: int,
        *,
        b_estimate_waiting: Optional[int] = None,
    ) -> CoreActionResult:
        ...

    def set_performer(
        self,
        core_order_id: int,
        *,
        user_id: int,
        performer: str,
        t_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> CoreActionResult:
        ...

    def set_offer(
        self,
        core_order_id: int,
        *,
        user_id: int,
        t_id: Optional[str] = None,
    ) -> CoreActionResult:
        ...

    def set_cancel_state(
        self,
        core_order_id: int,
        *,
        reason: Optional[str] = None,
        cancel_states: Optional[str] = None,
        forced: Optional[bool] = None,
    ) -> CoreActionResult:
        ...

    def set_arrive_state(self, core_order_id: int) -> CoreActionResult:
        ...

    def set_start_state(self, core_order_id: int) -> CoreActionResult:
        ...

    def set_complete_state(self, core_order_id: int) -> CoreActionResult:
        ...


class MissingCoreOrderError(RuntimeError):
    """Raised when a domain action requires a core_order_id but no mapping exists."""
