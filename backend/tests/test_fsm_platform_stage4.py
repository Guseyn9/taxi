from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from fsm import FsmProcedureResult
from fsm_core import FsmEngine, FsmRegistry, ProcessDef, Trigger
from fsm_core.outbox import DeliveryResult, OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.realtime import RealtimeHub, realtime_channel
from fsm_core.realtime_api import create_realtime_router
from fsm_core.security import ApiKeyPrincipalProvider, Principal
from fsm_core.snapshots import SnapshotService
from fsm_core.types import TransitionDef


class _Result:
    def __init__(self, row=None, rowcount=1):
        self.row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self.row

    def fetchall(self):
        return []


class _OutboxState:
    def __init__(self):
        self.status = "PENDING"
        self.attempts = 0
        self.last_error = None
        self.response_json = None
        self.sessions = []


class _OutboxSession:
    def __init__(self, state):
        self.state = state
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        if "SELECT id, service" in sql and "FROM core_outbox" in sql:
            if self.state.status not in {"PENDING", "RETRY"}:
                return _Result(None)
            return _Result(
                (
                    1,
                    "taxi",
                    "order",
                    42,
                    "set_performer",
                    '{"path":"/orders/42","body":{"performer":1}}',
                    "core_http",
                    self.state.attempts,
                    3,
                    "order-42-set-performer",
                )
            )
        if "SET status = 'PROCESSING'" in sql:
            self.state.status = "PROCESSING"
            self.state.attempts += 1
        elif "SET status = :status" in sql:
            self.state.status = params["status"]
            self.state.last_error = params["error"]
            self.state.response_json = params["response_json"]
        elif "Outbox processing lease expired" in sql:
            return _Result(rowcount=0)
        return _Result(rowcount=1)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class _OutboxSessionFactory:
    def __init__(self, state):
        self.state = state

    def __call__(self):
        session = _OutboxSession(self.state)
        self.state.sessions.append(session)
        return session


class OutboxDispatcherTests(unittest.TestCase):
    def test_delivery_runs_after_claim_commit_and_close(self):
        state = _OutboxState()
        factory = _OutboxSessionFactory(state)
        handlers = OutboxHandlerRegistry()

        def handler(event):
            claim_session = state.sessions[1]  # session 0 is stale recovery
            self.assertTrue(claim_session.committed)
            self.assertTrue(claim_session.closed)
            self.assertEqual(event.idempotency_key, "order-42-set-performer")
            return DeliveryResult(response={"accepted": True})

        handlers.register("core_http", handler)
        result = OutboxDispatcher(handlers).run_once(factory, limit=1)

        self.assertEqual(result.succeeded, 1)
        self.assertEqual(state.status, "SENT")
        self.assertIn("accepted", state.response_json)

    def test_failed_delivery_is_scheduled_for_retry(self):
        state = _OutboxState()
        factory = _OutboxSessionFactory(state)
        handlers = OutboxHandlerRegistry()

        def handler(event):
            del event
            raise RuntimeError("core unavailable")

        handlers.register("core_http", handler)
        result = OutboxDispatcher(handlers, retry_base_seconds=1).run_once(factory, limit=1)

        self.assertEqual(result.failed, 1)
        self.assertEqual(state.status, "RETRY")
        self.assertEqual(state.last_error, "core unavailable")


class RealtimeHubTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_is_fanned_out_to_subscriber(self):
        hub = RealtimeHub(queue_size=2)
        channel = realtime_channel("taxi", "order", 42)

        async with hub.subscribe(channel) as queue:
            subscribers = await hub.publish(channel, {"eventId": 7})
            self.assertEqual(subscribers, 1)
            self.assertEqual((await queue.get())["eventId"], 7)

        self.assertEqual(await hub.publish(channel, {"eventId": 8}), 0)


class TransitionRealtimeTests(unittest.TestCase):
    def test_event_recorder_runs_after_successful_transition(self):
        registry = FsmRegistry()
        registry.register_process(
            ProcessDef(
                service="taxi",
                process_name="cancel_order",
                entity_type="order",
                context_builder=lambda session, **kwargs: SimpleNamespace(
                    status="order_created"
                ),
                initial_action="order_cancel_by_client",
            )
        )
        recorded = []

        def recorder(session, **kwargs):
            del session
            recorded.append(kwargs)
            return 1

        engine = FsmEngine(registry, transition_event_recorder=recorder)
        transition = TransitionDef(
            action_name="order_cancel_by_client",
            from_state="order_created",
            to_state="order_cancelled",
        )
        with patch.object(engine.runner, "load_transition", return_value=transition), patch(
            "fsm_core.transition_runner.call_fsm_action",
            return_value=FsmProcedureResult(ok=True, message="done"),
        ):
            result = engine.run_action(
                object(),
                service="taxi",
                process_name="cancel_order",
                entity_type="order",
                entity_id=42,
                trigger=Trigger("command", "cancel_requested"),
                user_id=7,
            )

        self.assertTrue(result.ok)
        self.assertEqual(recorded[0]["entity_id"], 42)
        self.assertEqual(recorded[0]["transition"].to_state, "order_cancelled")


class RealtimeApiTests(unittest.TestCase):
    def test_websocket_starts_with_role_aware_snapshot(self):
        class Session:
            def rollback(self):
                pass

            def close(self):
                pass

        registry = FsmRegistry()
        registry.register_access_policy(
            "taxi",
            "order",
            lambda session, **kwargs: True,
        )
        registry.register_snapshot_builder(
            "taxi",
            "order",
            lambda session, **kwargs: {
                "orderId": kwargs["entity_id"],
                "audienceRole": kwargs["principal"].primary_role,
                "availableActions": ["cancel"],
            },
        )
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.fsm_registry = registry
        app.state.session_factory = Session
        app.state.realtime_hub = RealtimeHub()
        app.state.snapshot_service = SnapshotService(registry, Session)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {
                "client-token": Principal(
                    user_id=7,
                    roles=("client",),
                )
            }
        )

        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/realtime/ws/taxi/order/42?role=admin",
                headers={"Authorization": "Bearer client-token"},
            ) as websocket:
                message = websocket.receive_json()

        self.assertEqual(message["type"], "snapshot")
        self.assertEqual(message["snapshot"]["orderId"], 42)
        self.assertEqual(message["snapshot"]["audienceRole"], "client")
        self.assertEqual(message["snapshot"]["availableActions"], ["cancel"])
        # The subscription is released as soon as the client disconnects.
        self.assertEqual(app.state.realtime_hub._subscribers, {})

    def _realtime_app(self):
        class Session:
            def rollback(self):
                pass

            def close(self):
                pass

        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda session, **kwargs: True)
        registry.register_snapshot_builder(
            "taxi",
            "order",
            lambda session, **kwargs: {"orderId": kwargs["entity_id"]},
        )
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.fsm_registry = registry
        app.state.session_factory = Session
        app.state.realtime_hub = RealtimeHub()
        app.state.snapshot_service = SnapshotService(registry, Session)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {"client-token": Principal(user_id=7, roles=("client",))}
        )
        return app

    def test_websocket_pushes_entity_update(self):
        app = self._realtime_app()
        with TestClient(app) as client:
            with client.websocket_connect(
                "/api/realtime/ws/taxi/order/42",
                headers={"Authorization": "Bearer client-token"},
            ) as websocket:
                self.assertEqual(websocket.receive_json()["type"], "snapshot")
                client.portal.call(
                    app.state.realtime_hub.publish,
                    realtime_channel("taxi", "order", 42),
                    {"eventId": 5},
                )
                message = websocket.receive_json()

        self.assertEqual(message["type"], "entity.updated")
        self.assertEqual(message["event"], {"eventId": 5})
        self.assertEqual(message["snapshot"]["orderId"], 42)
        self.assertEqual(app.state.realtime_hub._subscribers, {})

    def test_websocket_pings_idle_client(self):
        app = self._realtime_app()
        with patch("fsm_core.realtime_api.PING_INTERVAL_SECONDS", 0.05):
            with TestClient(app) as client:
                with client.websocket_connect(
                    "/api/realtime/ws/taxi/order/42",
                    headers={"Authorization": "Bearer client-token"},
                ) as websocket:
                    websocket.receive_json()
                    message = websocket.receive_json()

        self.assertEqual(message, {"type": "ping"})


if __name__ == "__main__":
    unittest.main()
