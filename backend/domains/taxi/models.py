"""Domain models for the taxi order package.

These are domain-facing data structures, not database table mirrors. Candidate
and Offer intentionally live in order metadata for the MVP.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional


class OrderMode(str, Enum):
    DIRECT = "DIRECT"
    VOTE = "VOTE"
    OFFER = "OFFER"


class OrderStatus(str, Enum):
    CREATED = "order_created"
    VOTE_WAITING_CANDIDATES = "order_vote_waiting_candidates"
    VOTE_DRIVER_ASSIGNED = "order_vote_driver_assigned"
    VOTE_NO_SHOW = "order_vote_no_show"
    DRIVER_ASSIGNED = "order_driver_assigned"
    DRIVER_ARRIVED = "order_driver_arrived"
    IN_RIDE = "order_in_ride"
    COMPLETED = "order_completed"
    CANCELLED = "order_cancelled"
    EXPIRED = "order_expired"
    RIDE_INTERRUPTED = "ride_interrupted"
    OFFER_WAITING = "order_offer_waiting"
    DRIVER_CANCEL_PENDING = "order_driver_cancel_pending"


@dataclass
class Candidate:
    user_id: int
    car_id: Optional[int] = None
    state: Optional[int] = None
    price: Optional[Decimal] = None
    eta: Optional[str] = None
    comment: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_metadata(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "car_id": self.car_id,
            "state": self.state,
            "price": str(self.price) if self.price is not None else None,
            "eta": self.eta,
            "comment": self.comment,
            "metadata": self.metadata,
        }


@dataclass
class Offer:
    user_id: int
    price: Optional[Decimal] = None
    eta: Optional[str] = None
    comment: Optional[str] = None
    trip_ids: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_metadata(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "price": str(self.price) if self.price is not None else None,
            "eta": self.eta,
            "comment": self.comment,
            "trip_ids": self.trip_ids,
            "metadata": self.metadata,
        }


@dataclass
class Ride:
    order_id: int
    driver_user_id: int
    arrived_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Incident:
    order_id: int
    incident_type: str
    description: Optional[str] = None
    user_id: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_metadata(self) -> Dict[str, Any]:
        return {
            "order_id": self.order_id,
            "incident_type": self.incident_type,
            "description": self.description,
            "user_id": self.user_id,
            "metadata": self.metadata,
        }


@dataclass
class Order:
    id: int
    status: str
    mode: OrderMode = OrderMode.DIRECT
    description: Optional[str] = None
    metadata_json: Dict[str, Any] = field(default_factory=dict)
    core_order_id: Optional[int] = None
    b_state: Optional[int] = None

    @property
    def candidates(self) -> List[Dict[str, Any]]:
        value = self.metadata_json.get("candidates", [])
        return value if isinstance(value, list) else []

    @property
    def offers(self) -> List[Dict[str, Any]]:
        value = self.metadata_json.get("offers", [])
        return value if isinstance(value, list) else []
