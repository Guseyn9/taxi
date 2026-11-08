"""Courier/postamat domain package for FSM Platform."""

from .actions import CourierActionResult, CourierActionsFacade
from .available_actions import resolve_available_action_details, resolve_available_actions
from .models import CourierContext, CourierOrder, CourierTrip, LockerCell
from .processes import register_courier_processes
from .query_api import get_courier_snapshot

__all__ = [
    "CourierActionResult",
    "CourierActionsFacade",
    "CourierContext",
    "CourierOrder",
    "CourierTrip",
    "LockerCell",
    "get_courier_snapshot",
    "register_courier_processes",
    "resolve_available_action_details",
    "resolve_available_actions",
]
