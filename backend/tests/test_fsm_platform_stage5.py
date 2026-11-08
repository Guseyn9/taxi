from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from fsm import FsmProcedureResult
from fsm_core import FsmEngine, FsmRegistry, ProcessDef, Trigger
from fsm_core.realtime_api import create_realtime_router
from fsm_core.security import ApiKeyPrincipalProvider, Principal
from fsm_core.snapshots import ReadOnlySession, SnapshotService
from fsm_core.types import EffectResult, TransitionDef
from fsm_core.workers import enqueue_instance_trigger


class _Result:
    def __init__(self, row=None, rowcount=1):
        self._row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self._row


class PostTransitionContextTests(unittest.TestCase):
    def test_effect_receives_rebuilt_post_transition_context(self):
        current = {"status": "created"}
        seen = []

        def context_builder(session, **kwargs):
            del session, kwargs
            return SimpleNamespace(status=current["status"])

        def effect(session, context, params):
            del session, params
            seen.append(context.status)
            return EffectResult(ok=True)

        registry = FsmRegistry()
        registry.register_process(
            ProcessDef(
                service="test",
                process_name="lifecycle",
                entity_type="order",
                context_builder=context_builder,
                initial_action="publish",
            )
        )
        registry.register_effect("capture_post_context", effect)
        engine = FsmEngine(registry)
        transition = TransitionDef(
            action_name="publish",
            from_state="created",
            to_state="published",
            effect_name="capture_post_context",
        )

        def apply_transition(*args, **kwargs):
            del args, kwargs
            current["status"] = "published"
            return FsmProcedureResult(ok=True, message="done")

        with patch.object(engine.runner, "load_transition", return_value=transition), patch(
            "fsm_core.transition_runner.call_fsm_action",
            side_effect=apply_transition,
        ):
            result = engine.run_action(
                object(),
                service="test",
                process_name="lifecycle",
                entity_type="order",
                entity_id=1,
                trigger=Trigger("command", "publish"),
                user_id=7,
            )

        self.assertTrue(result.ok)
        self.assertEqual(seen, ["published"])


class EnqueueContractTests(unittest.TestCase):
    def test_each_trigger_is_inserted_as_a_separate_worker_task(self):
        class Session:
            def __init__(self):
                self.inserts = 0

            def execute(self, statement, params=None):
                sql = str(statement)
                if "INSERT INTO server_fsm_instances" in sql:
                    self.inserts += 1
                    return _Result()
                if "SELECT LAST_INSERT_ID()" in sql:
                    return _Result((self.inserts,))
                raise AssertionError(sql)

        session = Session()
        for name in ("first", "second"):
            self.assertTrue(
                enqueue_instance_trigger(
                    session,
                    service="taxi",
                    process_name="taxi_order_lifecycle",
                    entity_type="order",
                    entity_id=42,
                    trigger=Trigger("command", name),
                    user_id=7,
                )
            )
        self.assertEqual(session.inserts, 2)


class SnapshotContractTests(unittest.TestCase):
    def test_read_only_session_rejects_mutating_sql(self):
        class Session:
            def execute(self, statement, params=None):
                del statement, params
                return _Result()

        session = ReadOnlySession(Session())
        with self.assertRaisesRegex(RuntimeError, "mutating SQL"):
            session.execute("UPDATE orders SET status = 'x'")
        with self.assertRaisesRegex(RuntimeError, "cannot commit"):
            session.commit()

    def test_role_query_cannot_escalate_authenticated_principal(self):
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
            lambda session, **kwargs: {
                "role": kwargs["principal"].primary_role,
            },
        )
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.fsm_registry = registry
        app.state.session_factory = Session
        app.state.snapshot_service = SnapshotService(registry, Session)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {"driver-token": Principal(user_id=9, roles=("driver",))}
        )

        with TestClient(app) as client:
            response = client.get(
                "/api/realtime/snapshot/taxi/order/42?role=admin",
                headers={"Authorization": "Bearer driver-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "driver")

    def test_snapshot_requires_authentication(self):
        class Session:
            def rollback(self):
                pass

            def close(self):
                pass

        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda session, **kwargs: True)
        registry.register_snapshot_builder(
            "taxi", "order", lambda session, **kwargs: {"ok": True}
        )
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.snapshot_service = SnapshotService(registry, Session)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {"valid-token": Principal(user_id=9, roles=("driver",))}
        )

        with TestClient(app) as client:
            response = client.get("/api/realtime/snapshot/taxi/order/42")

        self.assertEqual(response.status_code, 401)

    def test_snapshot_returns_forbidden_when_entity_policy_rejects(self):
        class Session:
            def rollback(self):
                pass

            def close(self):
                pass

        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda session, **kwargs: False)
        registry.register_snapshot_builder(
            "taxi", "order", lambda session, **kwargs: {"secret": True}
        )
        app = FastAPI()
        app.include_router(create_realtime_router())
        app.state.snapshot_service = SnapshotService(registry, Session)
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {"driver-token": Principal(user_id=9, roles=("driver",))}
        )

        with TestClient(app) as client:
            response = client.get(
                "/api/realtime/snapshot/taxi/order/42",
                headers={"Authorization": "Bearer driver-token"},
            )

        self.assertEqual(response.status_code, 403)

    def test_entity_access_policy_is_required(self):
        class Session:
            def rollback(self):
                pass

            def close(self):
                pass

        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda session, **kwargs: False)
        registry.register_snapshot_builder(
            "taxi", "order", lambda session, **kwargs: {"secret": True}
        )
        service = SnapshotService(registry, Session)

        with self.assertRaisesRegex(Exception, "Access denied"):
            service.build(
                principal=Principal(user_id=9, roles=("driver",)),
                service="taxi",
                entity_type="order",
                entity_id=42,
            )


if __name__ == "__main__":
    unittest.main()
