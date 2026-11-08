from __future__ import annotations

import unittest

from domains.taxi.models import Order, OrderMode
from domains.taxi.processes import register_taxi_processes
from fsm import FsmProcedureError, call_fsm_action
from fsm_core import FsmRegistry, ProcessDef, Trigger
from fsm_core.registry import RegistryError


class _StoredResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.call = None

    def callproc(self, name, arguments):
        self.call = (name, arguments)

    def stored_results(self):
        return [_StoredResult(self.rows)]

    def nextset(self):
        return None

    def close(self):
        pass


class _DbapiConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


class _SessionConnection:
    def __init__(self, dbapi_connection):
        self.connection = dbapi_connection


class _Session:
    def __init__(self, rows):
        self.cursor = _Cursor(rows)

    def connection(self):
        return _SessionConnection(_DbapiConnection(self.cursor))


def _context_builder(session, *, entity_type, entity_id):
    del session, entity_type, entity_id
    return object()


class ProcedureContractTests(unittest.TestCase):
    def test_runtime_uses_v2_with_expected_state(self):
        session = _Session([("OK", "transition applied")])

        result = call_fsm_action(
            session,
            service="taxi",
            entity_type="order",
            entity_id=12,
            action_name="order_start",
            expected_state="order_driver_arrived",
            user_id=7,
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.code, "OK")
        self.assertEqual(
            session.cursor.call,
            (
                "fsm_perform_action_v2",
                [
                    "taxi",
                    "order",
                    12,
                    "order_start",
                    "order_driver_arrived",
                    7,
                    "",
                ],
            ),
        )

    def test_transition_conflict_is_an_error(self):
        session = _Session([("TRANSITION_CONFLICT", "stale state")])

        with self.assertRaisesRegex(FsmProcedureError, "TRANSITION_CONFLICT"):
            call_fsm_action(
                session,
                service="taxi",
                entity_type="order",
                entity_id=12,
                action_name="order_start",
                expected_state="order_driver_arrived",
                user_id=7,
            )


class RegistryContractTests(unittest.TestCase):
    def test_process_must_have_exactly_one_action_source(self):
        registry = FsmRegistry()

        with self.assertRaises(RegistryError):
            registry.register_process(
                ProcessDef(
                    service="test",
                    process_name="invalid",
                    entity_type="order",
                    context_builder=_context_builder,
                )
            )

    def test_taxi_payload_cannot_override_fsm_action(self):
        registry = FsmRegistry()
        register_taxi_processes(registry)
        process = registry.get_process("taxi", "taxi_order_creation")
        context = Order(id=1, status="order_created", mode=OrderMode.VOTE)

        action = process.resolve_action(
            context,
            Trigger(
                trigger_type="command",
                trigger_name="unknown",
                payload={"action_name": "order_finish"},
            ),
        )

        self.assertEqual(action, "order_publish_vote")


if __name__ == "__main__":
    unittest.main()

