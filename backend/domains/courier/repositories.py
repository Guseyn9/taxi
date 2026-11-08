"""Repository layer for the courier/postamat domain.

Repositories use the provided SQLAlchemy session only. They never create,
commit, roll back, or close sessions; that remains the worker boundary.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from fsm import FsmProcedureResult, call_fsm_action

from .models import CourierOrder, CourierTrip, LockerCell


class FsmTransitionRepository:
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


class CourierOrderRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        *,
        description: str,
        from_city: str,
        to_city: str,
        source_cell_id: Optional[int] = None,
        dest_cell_id: Optional[int] = None,
        pickup_type: str = "courier",
        delivery_type: str = "courier",
        status: str = "order_created",
    ) -> int:
        self.session.execute(
            text(
                """
                INSERT INTO orders (
                    status, description, pickup_type, delivery_type,
                    from_city, to_city, source_cell_id, dest_cell_id
                )
                VALUES (
                    :status, :description, :pickup_type, :delivery_type,
                    :from_city, :to_city, :source_cell_id, :dest_cell_id
                )
                """
            ),
            {
                "status": status,
                "description": description,
                "pickup_type": pickup_type,
                "delivery_type": delivery_type,
                "from_city": from_city,
                "to_city": to_city,
                "source_cell_id": source_cell_id,
                "dest_cell_id": dest_cell_id,
            },
        )
        row = self.session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
        return int(row[0]) if row and row[0] else 0

    def get(self, order_id: int, *, for_update: bool = False) -> Optional[CourierOrder]:
        query = """
            SELECT id, status, description, pickup_type, delivery_type,
                   from_city, to_city, source_cell_id, dest_cell_id
            FROM orders
            WHERE id = :order_id
        """
        if for_update:
            query += " FOR UPDATE"
        row = self.session.execute(text(query), {"order_id": order_id}).fetchone()
        if not row:
            return None
        return CourierOrder(
            id=int(row[0]),
            status=str(row[1]),
            description=row[2],
            pickup_type=row[3],
            delivery_type=row[4],
            from_city=row[5],
            to_city=row[6],
            source_cell_id=row[7],
            dest_cell_id=row[8],
        )

    def list_for_route(
        self,
        *,
        from_city: str,
        to_city: str,
        statuses: Optional[List[str]] = None,
    ) -> List[CourierOrder]:
        query = """
            SELECT id, status, description, pickup_type, delivery_type,
                   from_city, to_city, source_cell_id, dest_cell_id
            FROM orders
            WHERE from_city = :from_city
              AND to_city = :to_city
        """
        params: Dict[str, Any] = {"from_city": from_city, "to_city": to_city}
        if statuses:
            names = ", ".join(f":status_{idx}" for idx, _ in enumerate(statuses))
            query += f" AND status IN ({names})"
            params.update({f"status_{idx}": value for idx, value in enumerate(statuses)})
        rows = self.session.execute(text(query), params).fetchall()
        return [
            CourierOrder(
                id=int(row[0]),
                status=str(row[1]),
                description=row[2],
                pickup_type=row[3],
                delivery_type=row[4],
                from_city=row[5],
                to_city=row[6],
                source_cell_id=row[7],
                dest_cell_id=row[8],
            )
            for row in rows
        ]


class CourierTripRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        *,
        from_city: str,
        to_city: str,
        driver_user_id: Optional[int] = None,
        description: Optional[str] = None,
        active: int = 0,
        status: str = "trip_created",
    ) -> int:
        self.session.execute(
            text(
                """
                INSERT INTO trips (
                    driver_user_id, from_city, to_city, status, description, active
                )
                VALUES (
                    :driver_user_id, :from_city, :to_city, :status, :description, :active
                )
                """
            ),
            {
                "driver_user_id": driver_user_id,
                "from_city": from_city,
                "to_city": to_city,
                "status": status,
                "description": description,
                "active": active,
            },
        )
        row = self.session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
        return int(row[0]) if row and row[0] else 0

    def get(self, trip_id: int, *, for_update: bool = False) -> Optional[CourierTrip]:
        query = """
            SELECT id, status, active, from_city, to_city, driver_user_id, description
            FROM trips
            WHERE id = :trip_id
        """
        if for_update:
            query += " FOR UPDATE"
        row = self.session.execute(text(query), {"trip_id": trip_id}).fetchone()
        if not row:
            return None
        return CourierTrip(
            id=int(row[0]),
            status=str(row[1]),
            active=int(row[2] or 0),
            from_city=row[3],
            to_city=row[4],
            driver_user_id=row[5],
            description=row[6],
        )

    def assign_order(self, *, trip_id: int, order_id: int) -> None:
        self.session.execute(
            text(
                """
                INSERT INTO stage_orders (trip_id, order_id)
                VALUES (:trip_id, :order_id)
                """
            ),
            {"trip_id": trip_id, "order_id": order_id},
        )

    def set_courier1(self, *, order_id: int, courier_id: int) -> None:
        self.session.execute(
            text("UPDATE stage_orders SET courier1_user_id = :courier_id WHERE order_id = :order_id"),
            {"courier_id": courier_id, "order_id": order_id},
        )

    def set_courier2(self, *, order_id: int, courier_id: int) -> None:
        self.session.execute(
            text("UPDATE stage_orders SET courier2_user_id = :courier_id WHERE order_id = :order_id"),
            {"courier_id": courier_id, "order_id": order_id},
        )

    def get_order_ids(self, trip_id: int) -> List[int]:
        rows = self.session.execute(
            text("SELECT order_id FROM stage_orders WHERE trip_id = :trip_id"),
            {"trip_id": trip_id},
        ).fetchall()
        return [int(row[0]) for row in rows]


class LockerRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_cell(self, cell_id: int, *, for_update: bool = False) -> Optional[LockerCell]:
        query = """
            SELECT id, locker_id, cell_code, cell_type, status,
                   current_order_id, reserved_for_user_id
            FROM locker_cells
            WHERE id = :cell_id
        """
        if for_update:
            query += " FOR UPDATE"
        row = self.session.execute(text(query), {"cell_id": cell_id}).fetchone()
        if not row:
            return None
        return LockerCell(
            id=int(row[0]),
            locker_id=row[1],
            cell_code=row[2],
            cell_type=row[3],
            status=str(row[4]),
            current_order_id=row[5],
            reserved_for_user_id=row[6],
        )


class ButtonRepository:
    def __init__(self, session: Session):
        self.session = session

    def list_for_state(self, *, user_role: str, entity_state: str) -> List[Dict[str, Any]]:
        rows = self.session.execute(
            text(
                """
                SELECT button_name, is_enabled
                FROM button_states
                WHERE user_role = :user_role
                  AND entity_state = :entity_state
                """
            ),
            {"user_role": user_role, "entity_state": entity_state},
        ).fetchall()
        return [
            {
                "buttonName": row[0],
                "isEnabled": row[1] == "active" if isinstance(row[1], str) else bool(row[1]),
            }
            for row in rows
        ]


class CourierUnitOfWorkRepositories:
    def __init__(self, session: Session):
        self.orders = CourierOrderRepository(session)
        self.trips = CourierTripRepository(session)
        self.lockers = LockerRepository(session)
        self.buttons = ButtonRepository(session)
        self.fsm = FsmTransitionRepository(session)

    def get_entity_state(self, entity_type: str, entity_id: int) -> Tuple[str, Any]:
        if entity_type == "order":
            entity = self.orders.get(entity_id, for_update=True)
        elif entity_type == "trip":
            entity = self.trips.get(entity_id, for_update=True)
        elif entity_type == "locker":
            entity = self.lockers.get_cell(entity_id, for_update=True)
        else:
            raise ValueError(f"Unsupported courier entity_type: {entity_type}")
        if entity is None:
            raise ValueError(f"{entity_type} #{entity_id} not found")
        return entity.status, entity
