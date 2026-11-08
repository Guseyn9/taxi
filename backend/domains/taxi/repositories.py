"""Repository/ORM layer for the taxi domain.

Repositories never create, commit, roll back, or close sessions. The worker owns
the SQLAlchemy session and transaction boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from fsm import FsmProcedureResult, call_fsm_action
from fsm_core.outbox import OutboxCompletion, enqueue_outbox_event
from fsm_core.serialization import json_dumps, json_loads_object

from .models import Candidate, Incident, Offer, Order, OrderMode, OrderStatus


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


@dataclass(frozen=True)
class CoreOrderMapping:
    local_order_id: int
    core_order_id: Optional[int] = None
    role: Optional[str] = None
    kind: Optional[int] = None
    upper: Optional[int] = None
    b_state: Optional[int] = None
    client_local_user_id: Optional[int] = None
    performer_local_user_id: Optional[int] = None


class FsmTransitionRepository:
    """Thin repository wrapper around fsm_perform_action."""

    def __init__(self, session: Session):
        self.session = session

    def transition(
        self,
        entity_type: str,
        entity_id: int,
        action_name: str,
        user_id: int,
        extra_id: Optional[str] = None,
    ) -> FsmProcedureResult:
        return call_fsm_action(
            self.session,
            entity_type=entity_type,
            entity_id=entity_id,
            action_name=action_name,
            user_id=user_id,
            extra_id=extra_id,
        )


class OrderRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        *,
        mode: OrderMode,
        description: Optional[str] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
        status: str = OrderStatus.CREATED.value,
    ) -> int:
        metadata = _deep_merge(metadata_json or {}, {"mode": mode.value})
        self.session.execute(
            text(
                """
                INSERT INTO orders (status, description, metadata_json)
                VALUES (:status, :description, :metadata_json)
                """
            ),
            {
                "status": status,
                "description": description,
                "metadata_json": json_dumps(metadata),
            },
        )
        row = self.session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
        return int(row[0]) if row and row[0] else 0

    def get(self, order_id: int, *, for_update: bool = False) -> Optional[Order]:
        query = (
            "SELECT o.id, o.status, o.description, o.metadata_json, "
            "m.core_order_id, m.b_state "
            "FROM orders o "
            "LEFT JOIN core_order_mapping m ON m.local_order_id = o.id "
            "WHERE o.id = :order_id"
        )
        if for_update:
            query += " FOR UPDATE"
        row = self.session.execute(text(query), {"order_id": order_id}).fetchone()
        if not row:
            return None
        metadata = json_loads_object(row[3])
        mode = OrderMode(metadata.get("mode", OrderMode.DIRECT.value))
        return Order(
            id=int(row[0]),
            status=str(row[1]),
            description=row[2],
            metadata_json=metadata,
            mode=mode,
            core_order_id=row[4],
            b_state=row[5],
        )

    def list_visible_to_driver(self, driver_user_id: int) -> List[Order]:
        rows = self.session.execute(
            text(
                """
                SELECT o.id, o.status, o.description, o.metadata_json,
                       m.core_order_id, m.b_state, m.performer_local_user_id
                FROM orders o
                LEFT JOIN core_order_mapping m ON m.local_order_id = o.id
                WHERE m.performer_local_user_id = :driver_id
                   OR CAST(o.metadata_json AS CHAR) LIKE :metadata_needle
                ORDER BY o.id DESC
                """
            ),
            {
                "driver_id": driver_user_id,
                "metadata_needle": f"%{driver_user_id}%",
            },
        ).fetchall()
        orders: List[Order] = []
        for row in rows or []:
            metadata = json_loads_object(row[3])
            status = str(row[1])
            performer_id = int(row[6]) if row[6] is not None else None
            if not is_order_visible_to_driver(driver_user_id, performer_id, metadata, status):
                continue
            mode = OrderMode(metadata.get("mode", OrderMode.DIRECT.value))
            orders.append(
                Order(
                    id=int(row[0]),
                    status=status,
                    description=row[2],
                    metadata_json=metadata,
                    mode=mode,
                    core_order_id=row[4],
                    b_state=row[5],
                )
            )
        return orders

    def update_metadata(self, order_id: int, metadata_json: Dict[str, Any]) -> None:
        self.session.execute(
            text("UPDATE orders SET metadata_json = :metadata_json WHERE id = :order_id"),
            {"order_id": order_id, "metadata_json": json_dumps(metadata_json)},
        )

    def patch_metadata(self, order_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        order = self.get(order_id, for_update=True)
        if order is None:
            raise ValueError(f"Order #{order_id} not found")
        metadata = _deep_merge(order.metadata_json, patch)
        self.update_metadata(order_id, metadata)
        return metadata

    def upsert_candidate(self, order_id: int, candidate: Candidate) -> Dict[str, Any]:
        order = self.get(order_id, for_update=True)
        if order is None:
            raise ValueError(f"Order #{order_id} not found")

        metadata = dict(order.metadata_json)
        candidates = [
            item
            for item in metadata.get("candidates", [])
            if str(item.get("user_id")) != str(candidate.user_id)
        ]
        candidates.append(candidate.to_metadata())
        metadata["candidates"] = candidates
        self.update_metadata(order_id, metadata)
        return metadata

    def select_candidate(self, order_id: int, driver_user_id: int) -> Dict[str, Any]:
        return self.patch_metadata(
            order_id,
            {"selected_candidate": {"user_id": driver_user_id}},
        )

    def release_candidate(self, order_id: int) -> Dict[str, Any]:
        return self.patch_metadata(order_id, {"selected_candidate": None})

    def upsert_offer(self, order_id: int, offer: Offer) -> Dict[str, Any]:
        order = self.get(order_id, for_update=True)
        if order is None:
            raise ValueError(f"Order #{order_id} not found")

        metadata = dict(order.metadata_json)
        offers = [
            item
            for item in metadata.get("offers", [])
            if str(item.get("user_id")) != str(offer.user_id)
        ]
        offers.append(offer.to_metadata())
        metadata["offers"] = offers
        self.update_metadata(order_id, metadata)
        return metadata

    def select_offer(self, order_id: int, driver_user_id: int) -> Dict[str, Any]:
        return self.patch_metadata(order_id, {"selected_offer": {"user_id": driver_user_id}})


class CoreOrderMappingRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_local_order_id(self, local_order_id: int) -> Optional[CoreOrderMapping]:
        row = self.session.execute(
            text(
                """
                SELECT local_order_id, core_order_id, role, kind, upper, b_state,
                       client_local_user_id, performer_local_user_id
                FROM core_order_mapping
                WHERE local_order_id = :local_order_id
                """
            ),
            {"local_order_id": local_order_id},
        ).fetchone()
        if not row:
            return None
        return CoreOrderMapping(
            local_order_id=int(row[0]),
            core_order_id=row[1],
            role=row[2],
            kind=row[3],
            upper=row[4],
            b_state=row[5],
            client_local_user_id=row[6],
            performer_local_user_id=row[7],
        )

    def upsert(
        self,
        *,
        local_order_id: int,
        core_order_id: Optional[int] = None,
        role: Optional[str] = None,
        kind: Optional[int] = None,
        upper: Optional[int] = None,
        b_state: Optional[int] = None,
        client_local_user_id: Optional[int] = None,
        performer_local_user_id: Optional[int] = None,
    ) -> None:
        self.session.execute(
            text(
                """
                INSERT INTO core_order_mapping (
                    local_order_id, core_order_id, role, kind, upper, b_state,
                    client_local_user_id, performer_local_user_id
                )
                VALUES (
                    :local_order_id, :core_order_id, :role, :kind, :upper, :b_state,
                    :client_local_user_id, :performer_local_user_id
                )
                ON DUPLICATE KEY UPDATE
                    core_order_id = VALUES(core_order_id),
                    role = VALUES(role),
                    kind = VALUES(kind),
                    upper = VALUES(upper),
                    b_state = VALUES(b_state),
                    client_local_user_id = VALUES(client_local_user_id),
                    performer_local_user_id = VALUES(performer_local_user_id)
                """
            ),
            {
                "local_order_id": local_order_id,
                "core_order_id": core_order_id,
                "role": role,
                "kind": kind,
                "upper": upper,
                "b_state": b_state,
                "client_local_user_id": client_local_user_id,
                "performer_local_user_id": performer_local_user_id,
            },
        )

    def update_b_state(self, local_order_id: int, b_state: Optional[int]) -> None:
        self.session.execute(
            text(
                """
                UPDATE core_order_mapping
                SET b_state = :b_state
                WHERE local_order_id = :local_order_id
                """
            ),
            {"local_order_id": local_order_id, "b_state": b_state},
        )

    def update_performer(self, local_order_id: int, performer_user_id: Optional[int]) -> None:
        self.session.execute(
            text(
                """
                UPDATE core_order_mapping
                SET performer_local_user_id = :performer_user_id
                WHERE local_order_id = :local_order_id
                """
            ),
            {"local_order_id": local_order_id, "performer_user_id": performer_user_id},
        )


class FsmInstanceRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        *,
        entity_type: str,
        entity_id: int,
        process_name: str,
        fsm_state: str,
        service: Optional[str] = None,
        instance_status: str = "PENDING",
        trigger_type: Optional[str] = None,
        trigger_name: Optional[str] = None,
        trigger_payload: Optional[Dict[str, Any]] = None,
        requested_by_user_id: Optional[int] = None,
        requested_user_role: Optional[str] = None,
        target_user_id: Optional[int] = None,
        target_role: Optional[str] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> int:
        self.session.execute(
            text(
                """
                INSERT INTO server_fsm_instances (
                    service, entity_type, entity_id, process_name,
                    instance_status, trigger_type, trigger_name, trigger_payload,
                    fsm_state,
                    requested_by_user_id, requested_user_role,
                    target_user_id, target_role, metadata_json
                )
                VALUES (
                    :service, :entity_type, :entity_id, :process_name,
                    :instance_status, :trigger_type, :trigger_name, :trigger_payload,
                    :fsm_state,
                    :requested_by_user_id, :requested_user_role,
                    :target_user_id, :target_role, :metadata_json
                )
                """
            ),
            {
                "service": service,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "process_name": process_name,
                "instance_status": instance_status,
                "trigger_type": trigger_type,
                "trigger_name": trigger_name,
                "trigger_payload": json_dumps(trigger_payload or {}),
                "fsm_state": fsm_state,
                "requested_by_user_id": requested_by_user_id,
                "requested_user_role": requested_user_role,
                "target_user_id": target_user_id,
                "target_role": target_role,
                "metadata_json": json_dumps(metadata_json or {}),
            },
        )
        row = self.session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
        return int(row[0]) if row and row[0] else 0

    def set_state(self, entity_type: str, entity_id: int, fsm_state: str) -> None:
        self.session.execute(
            text(
                """
                UPDATE server_fsm_instances
                SET fsm_state = :fsm_state
                WHERE entity_type = :entity_type AND entity_id = :entity_id
                """
            ),
            {"entity_type": entity_type, "entity_id": entity_id, "fsm_state": fsm_state},
        )

    def set_error(self, entity_type: str, entity_id: int, error: str) -> None:
        self.session.execute(
            text(
                """
                UPDATE server_fsm_instances
                SET attempts_count = attempts_count + 1, last_error = :error
                WHERE entity_type = :entity_type AND entity_id = :entity_id
                """
            ),
            {"entity_type": entity_type, "entity_id": entity_id, "error": error},
        )

    def set_instance_status(self, entity_type: str, entity_id: int, instance_status: str) -> None:
        self.session.execute(
            text(
                """
                UPDATE server_fsm_instances
                SET instance_status = :instance_status
                WHERE entity_type = :entity_type AND entity_id = :entity_id
                """
            ),
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "instance_status": instance_status,
            },
        )


class TaxiTripRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        *,
        order_id: int,
        driver_user_id: Optional[int] = None,
        status: str = "trip_created",
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> int:
        self.session.execute(
            text(
                """
                INSERT INTO taxi_trips (
                    order_id, driver_user_id, status, metadata_json
                )
                VALUES (
                    :order_id, :driver_user_id, :status, :metadata_json
                )
                """
            ),
            {
                "order_id": order_id,
                "driver_user_id": driver_user_id,
                "status": status,
                "metadata_json": json_dumps(metadata_json or {}),
            },
        )
        row = self.session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
        return int(row[0]) if row and row[0] else 0

    def mark_started(self, order_id: int) -> None:
        self.session.execute(
            text(
                """
                UPDATE taxi_trips
                SET status = 'trip_started', started_at = CURRENT_TIMESTAMP
                WHERE order_id = :order_id AND started_at IS NULL
                """
            ),
            {"order_id": order_id},
        )

    def mark_finished(
        self,
        *,
        order_id: int,
        actual_price: Optional[Decimal] = None,
        currency: Optional[str] = None,
        outcome: str = "completed",
    ) -> None:
        self.session.execute(
            text(
                """
                UPDATE taxi_trips
                SET status = 'trip_finished',
                    finished_at = CURRENT_TIMESTAMP,
                    actual_price = :actual_price,
                    currency = :currency,
                    outcome = :outcome
                WHERE order_id = :order_id
                """
            ),
            {
                "order_id": order_id,
                "actual_price": actual_price,
                "currency": currency,
                "outcome": outcome,
            },
        )


class CoreOutboxRepository:
    def __init__(self, session: Session):
        self.session = session

    def enqueue(
        self,
        *,
        service: str,
        aggregate_type: str,
        aggregate_id: int,
        event_type: str,
        payload: Dict[str, Any],
        idempotency_key: str,
        handler_name: str = "core_http",
        max_attempts: int = 8,
        completion: Optional[OutboxCompletion] = None,
    ) -> int:
        return enqueue_outbox_event(
            self.session,
            service=service,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            event_type=event_type,
            payload=payload,
            idempotency_key=idempotency_key,
            handler_name=handler_name,
            max_attempts=max_attempts,
            completion=completion,
        )


class PayloadTemplateRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_create_payload(self, code: str) -> Dict[str, Any]:
        row = self.session.execute(
            text(
                """
                SELECT create_payload_json
                FROM taxi_order_payload_templates
                WHERE code = :code
                """
            ),
            {"code": code},
        ).fetchone()
        if not row:
            raise ValueError(f"Taxi payload template '{code}' not found")
        return json_loads_object(row[0])


class IncidentRepository:
    """MVP incident storage inside orders.metadata_json."""

    def __init__(self, session: Session):
        self.orders = OrderRepository(session)

    def create_for_order(self, incident: Incident) -> Dict[str, Any]:
        order = self.orders.get(incident.order_id, for_update=True)
        if order is None:
            raise ValueError(f"Order #{incident.order_id} not found")
        metadata = dict(order.metadata_json)
        incidents = list(metadata.get("incidents", []))
        incidents.append(incident.to_metadata())
        metadata["incidents"] = incidents
        self.orders.update_metadata(incident.order_id, metadata)
        return metadata


_READY_STATES = {
    OrderStatus.VOTE_WAITING_CANDIDATES.value,
    OrderStatus.OFFER_WAITING.value,
}


def is_assigned_driver(
    driver_user_id: int,
    performer_id: Optional[int],
    metadata: Dict[str, Any],
) -> bool:
    """Whether the driver took the order (Core performer or selected in FSM)."""
    if performer_id is not None:
        return int(performer_id) == driver_user_id
    if _metadata_user_matches(metadata.get("selected_candidate"), driver_user_id):
        return True
    if _metadata_user_matches(metadata.get("selected_offer"), driver_user_id):
        return True
    return str(metadata.get("driver_user_id")) == str(driver_user_id)


def is_order_visible_to_driver(
    driver_user_id: int,
    performer_id: Optional[int],
    metadata: Dict[str, Any],
    status: str,
) -> bool:
    """The assigned driver always sees the order; candidates only while searching."""
    if is_assigned_driver(driver_user_id, performer_id, metadata):
        return True
    if driver_user_id in metadata.get("cancelled_driver_user_ids", []):
        return True
    if performer_id is not None:
        return False
    if status not in _READY_STATES:
        return False
    return _list_contains_user(metadata.get("candidates"), driver_user_id) or _list_contains_user(
        metadata.get("offers"),
        driver_user_id,
    )


def _metadata_user_matches(value: Any, driver_user_id: int) -> bool:
    return isinstance(value, dict) and str(value.get("user_id")) == str(driver_user_id)


def _list_contains_user(items: Any, driver_user_id: int) -> bool:
    if not isinstance(items, list):
        return False
    return any(_metadata_user_matches(item, driver_user_id) for item in items)
