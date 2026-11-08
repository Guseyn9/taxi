"""Domain-facing models for the courier/postamat delivery domain."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class CourierOrder:
    id: int
    status: str
    description: Optional[str] = None
    pickup_type: Optional[str] = None
    delivery_type: Optional[str] = None
    from_city: Optional[str] = None
    to_city: Optional[str] = None
    source_cell_id: Optional[int] = None
    dest_cell_id: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CourierTrip:
    id: int
    status: str
    active: int = 0
    from_city: Optional[str] = None
    to_city: Optional[str] = None
    driver_user_id: Optional[int] = None
    description: Optional[str] = None


@dataclass
class LockerCell:
    id: int
    status: str
    locker_id: Optional[int] = None
    cell_code: Optional[str] = None
    cell_type: Optional[str] = None
    current_order_id: Optional[int] = None
    reserved_for_user_id: Optional[int] = None


@dataclass
class CourierContext:
    entity_type: str
    entity_id: int
    status: str
    entity: CourierOrder | CourierTrip | LockerCell
