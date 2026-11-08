"""Driver Snapshot unit tests."""

from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from domains.taxi.available_actions import resolve_available_actions, resolve_driver_available_actions
from domains.taxi.processes import register_taxi_processes
from domains.taxi.query_api import get_driver_snapshot
from fsm_core.realtime_api import create_realtime_router
from fsm_core.registry import FsmRegistry
from fsm_core.security import ApiKeyPrincipalProvider, Principal
from fsm_core.snapshots import SnapshotService


class _Result:
    def __init__(self, rows=None, row=None):
        self._rows = list(rows or [])
        self._row = row if row is not None else (self._rows[0] if self._rows else None)

    def fetchone(self):
        return self._row

    def fetchall(self):
        return list(self._rows)


class DriverOrderSession:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        if "FROM orders o" in sql and "performer_local_user_id" in sql:
            return _Result(rows=self.rows)
        raise AssertionError(sql)

    def rollback(self):
        pass

    def close(self):
        pass


def _row(
    order_id,
    status,
    *,
    metadata,
    performer_id=None,
    core_order_id=None,
    b_state=None,
    description=None,
):
    return (
        order_id,
        status,
        description,
        metadata,
        core_order_id,
        b_state,
        performer_id,
    )


class DriverAvailableActionsTests(unittest.TestCase):
    def test_order_snapshot_keeps_driver_actions_empty(self):
        self.assertEqual(
            resolve_available_actions("order_driver_assigned", user_role="driver"),
            [],
        )

    def test_driver_actions_follow_frontend_names(self):
        self.assertEqual(
            resolve_driver_available_actions("order_driver_assigned", user_role="driver"),
            ["driver.order.arrive", "driver.order.cancel"],
        )
        self.assertEqual(
            resolve_driver_available_actions("order_driver_arrived", user_role="driver"),
            ["driver.order.start", "driver.order.confirm_boarding", "driver.order.cancel"],
        )
        self.assertEqual(
            resolve_driver_available_actions("order_in_ride", user_role="driver"),
            ["driver.order.finish"],
        )

    def test_driver_cancel_only_for_taken_orders(self):
        self.assertEqual(
            resolve_driver_available_actions("order_vote_driver_assigned", user_role="driver"),
            ["driver.order.arrive", "driver.order.cancel"],
        )
        for state in (
            "order_vote_waiting_candidates",
            "order_offer_waiting",
            "order_in_ride",
            "order_driver_cancel_pending",
            "order_cancelled",
        ):
            self.assertNotIn(
                "driver.order.cancel",
                resolve_driver_available_actions(state, user_role="driver"),
                state,
            )


class DriverSnapshotTests(unittest.TestCase):
    def test_buckets_ready_active_history_and_current_trip(self):
        session = DriverOrderSession(
            [
                _row(
                    10,
                    "order_vote_waiting_candidates",
                    metadata={
                        "mode": "VOTE",
                        "candidates": [{"user_id": 205}, {"user_id": 206}],
                    },
                ),
                _row(
                    11,
                    "order_driver_assigned",
                    metadata={"mode": "DIRECT", "driver_user_id": 205},
                    performer_id=205,
                ),
                _row(
                    12,
                    "order_completed",
                    metadata={"mode": "DIRECT"},
                    performer_id=205,
                ),
                _row(
                    13,
                    "order_vote_waiting_candidates",
                    metadata={"mode": "VOTE", "candidates": [{"user_id": 206}]},
                ),
                _row(
                    14,
                    "order_driver_assigned",
                    metadata={"mode": "DIRECT"},
                    performer_id=206,
                ),
            ]
        )
        snapshot = get_driver_snapshot(
            session,
            205,
            principal=Principal(user_id=205, roles=("driver",)),
        )

        self.assertEqual(snapshot["driverUserId"], 205)
        self.assertEqual(
            [item["orderId"] for item in snapshot["driver"]["readyOrders"]],
            [10],
        )
        self.assertEqual(
            [item["orderId"] for item in snapshot["driver"]["activeOrders"]],
            [11],
        )
        self.assertEqual(
            [item["orderId"] for item in snapshot["driver"]["historyOrders"]],
            [12],
        )
        self.assertEqual(snapshot["driver"]["currentTrip"]["orderId"], 11)
        self.assertEqual(snapshot["availableActions"], ["driver.order.arrive", "driver.order.cancel"])
        self.assertEqual(
            snapshot["driver"]["activeOrders"][0]["availableActions"],
            ["driver.order.arrive", "driver.order.cancel"],
        )

    def test_pending_driver_cancel_stays_active_without_actions(self):
        session = DriverOrderSession(
            [
                _row(
                    15,
                    "order_driver_cancel_pending",
                    metadata={"mode": "DIRECT"},
                    performer_id=205,
                ),
            ]
        )
        snapshot = get_driver_snapshot(
            session,
            205,
            principal=Principal(user_id=205, roles=("driver",)),
        )

        self.assertEqual(
            [item["orderId"] for item in snapshot["driver"]["activeOrders"]],
            [15],
        )
        self.assertEqual(snapshot["driver"]["currentTrip"]["orderId"], 15)
        self.assertEqual(snapshot["availableActions"], [])

    def test_http_driver_snapshot_and_foreign_driver_forbidden(self):
        rows = [
            _row(
                11,
                "order_driver_arrived",
                metadata={"mode": "DIRECT"},
                performer_id=205,
            )
        ]

        def session_factory():
            return DriverOrderSession(rows)

        registry = FsmRegistry()
        register_taxi_processes(registry)
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.snapshot_service = SnapshotService(registry, session_factory)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {
                "driver-205": Principal(user_id=205, roles=("driver",)),
                "driver-206": Principal(user_id=206, roles=("driver",)),
            }
        )

        with TestClient(app) as client:
            own = client.get(
                "/api/realtime/snapshot/taxi/driver/205",
                headers={"Authorization": "Bearer driver-205"},
            )
            foreign = client.get(
                "/api/realtime/snapshot/taxi/driver/205",
                headers={"Authorization": "Bearer driver-206"},
            )

        self.assertEqual(own.status_code, 200)
        body = own.json()
        self.assertEqual(body["driver"]["user"]["userId"], 205)
        self.assertEqual(body["driver"]["currentTrip"]["orderId"], 11)
        self.assertEqual(
            body["availableActions"],
            ["driver.order.start", "driver.order.confirm_boarding", "driver.order.cancel"],
        )
        self.assertEqual(foreign.status_code, 403)


if __name__ == "__main__":
    unittest.main()
