"""Driver cancels a taken order through the Command API.

Chain under test:

    driver.order.cancel -> driver_cancel_requested -> assigned-driver check
    -> can_driver_cancel_order -> order_driver_cancel_pending
    + core_outbox set_cancel_state (command stays PROCESSING)
    -> Core SENT  -> driver_cancel_confirmed -> order_cancelled, command COMPLETED
    -> Core FAILED -> driver_cancel_failed  -> previous state, command FAILED
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Dict, List, Optional
from unittest.mock import patch

from domains.taxi import effects as taxi_effects
from domains.taxi.fsm_spec import ORDER_TRANSITIONS, TaxiFsmActions, TaxiFsmStates
from domains.taxi.guards import can_driver_cancel_order
from domains.taxi.intents import (
    DRIVER_ROLES,
    PASSENGER_ROLES,
    TaxiIntentCatalog,
    normalize_taxi_intent,
    resolve_taxi_order_intent,
)
from domains.taxi.models import Order, OrderMode
from domains.taxi.processes import register_taxi_processes
from domains.taxi.security import can_access_taxi_entity, can_execute_taxi_order_command
from fsm_core import FsmRegistry, Trigger
from fsm_core.command_completion import defer_current_command_completion, execution_scope
from fsm_core.command_idempotency import COMPLETED, FAILED, PROCESSING
from fsm_core.command_service import CommandService
from fsm_core.errors import AuthorizationError
from fsm_core.outbox import DeliveryResult, OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.security import Principal
from fsm_core.snapshots import SnapshotService
from fsm_core.types import FsmResult
from fsm_core.workers import FsmInstanceWorker
from test_command_api import FakeSession, _make_envelope, _Result


def _order(status: str, **kwargs: Any) -> Order:
    return Order(id=42, status=status, mode=OrderMode.DIRECT, **kwargs)


def _lifecycle_process():
    registry = FsmRegistry()
    register_taxi_processes(registry)
    return registry.get_process("taxi", "taxi_order_lifecycle")


# --------------------------------------------------------------------------- #
# Intent, guard, FSM spec, action routing
# --------------------------------------------------------------------------- #


class DriverCancelIntentTests(unittest.TestCase):
    def test_driver_intent_and_alias(self):
        intent = resolve_taxi_order_intent("driver.order.cancel")
        self.assertEqual(normalize_taxi_intent("driver.order.cancel"), "driver_cancel_requested")
        self.assertEqual(intent.intent, "driver_cancel_requested")
        self.assertEqual(intent.allowed_roles, DRIVER_ROLES)
        self.assertEqual(intent.process_name, "taxi_order_lifecycle")

    def test_passenger_cancel_is_unchanged(self):
        intent = resolve_taxi_order_intent("cancel_requested")
        self.assertEqual(intent.allowed_roles, PASSENGER_ROLES)
        self.assertNotIn("driver", intent.allowed_roles)

    def test_internal_follow_up_triggers_are_not_client_intents(self):
        for trigger in ("driver_cancel_confirmed", "driver_cancel_failed"):
            with self.assertRaises(ValueError):
                resolve_taxi_order_intent(trigger)


class DriverCancelGuardTests(unittest.TestCase):
    def test_allows_only_taken_orders(self):
        for state in (
            TaxiFsmStates.ORDER_VOTE_DRIVER_ASSIGNED,
            TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
            TaxiFsmStates.ORDER_DRIVER_ARRIVED,
        ):
            self.assertTrue(can_driver_cancel_order(None, _order(state), {}).ok, state)

    def test_rejects_search_ride_and_terminal_states(self):
        for state in (
            TaxiFsmStates.ORDER_CREATED,
            TaxiFsmStates.ORDER_VOTE_WAITING_CANDIDATES,
            TaxiFsmStates.ORDER_OFFER_WAITING,
            TaxiFsmStates.ORDER_IN_RIDE,
            TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING,
            TaxiFsmStates.ORDER_CANCELLED,
            TaxiFsmStates.ORDER_COMPLETED,
        ):
            result = can_driver_cancel_order(None, _order(state), {})
            self.assertFalse(result.ok, state)
            self.assertTrue(result.reason)


class DriverCancelSpecTests(unittest.TestCase):
    def test_driver_cancel_reopens_the_order_after_core_confirmation(self):
        cancel = [t for t in ORDER_TRANSITIONS if t.action == TaxiFsmActions.ORDER_CANCEL_BY_DRIVER]
        self.assertEqual(
            {t.from_state for t in cancel},
            {
                TaxiFsmStates.ORDER_DRIVER_ASSIGNED,
                TaxiFsmStates.ORDER_DRIVER_ARRIVED,
            },
        )
        for transition in cancel:
            self.assertEqual(transition.to_state, TaxiFsmStates.ORDER_CREATED)
            self.assertEqual(transition.guard_name, "can_driver_cancel_order")
            self.assertIsNone(transition.effect_name)

    def test_pending_resolves_to_cancelled_or_back(self):
        from_pending = {
            t.action: t.to_state
            for t in ORDER_TRANSITIONS
            if t.from_state == TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING
        }
        self.assertEqual(from_pending, {})



class DriverCancelActionResolverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.process = _lifecycle_process()

    def test_command_and_confirmation_routing(self):
        context = _order(TaxiFsmStates.ORDER_DRIVER_ASSIGNED)
        self.assertEqual(
            self.process.resolve_action(context, Trigger("command", "driver_cancel_requested")),
            "order_cancel_by_driver",
        )
        self.assertEqual(
            self.process.resolve_action(context, Trigger("event", "driver_cancel_confirmed")),
            "order_confirm_driver_cancel",
        )
        # Passenger cancellation keeps its own FSM action.
        self.assertEqual(
            self.process.resolve_action(context, Trigger("command", "cancel_requested")),
            "order_cancel_by_client",
        )

    def test_failure_reverts_to_recorded_previous_state(self):
        context = _order(
            TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING,
            metadata_json={"driver_cancel": {"previous_state": "order_driver_arrived"}},
        )
        self.assertEqual(
            self.process.resolve_action(context, Trigger("event", "driver_cancel_failed")),
            "order_revert_driver_cancel_to_arrived",
        )

    def test_failure_without_recorded_state_is_rejected(self):
        context = _order(TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING)
        with self.assertRaises(ValueError):
            self.process.resolve_action(context, Trigger("event", "driver_cancel_failed"))


# --------------------------------------------------------------------------- #
# Effect: Core request through outbox + deferred completion
# --------------------------------------------------------------------------- #


class DriverCancelEffectTests(unittest.TestCase):
    def test_effect_queues_core_cancel_and_defers_command(self):
        context = _order(TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING, core_order_id=15867)
        with patch.object(taxi_effects, "OrderRepository") as orders, patch.object(
            taxi_effects, "CoreOutboxRepository"
        ) as outbox:
            with execution_scope(77) as execution:
                result = taxi_effects.request_core_driver_cancel(
                    object(), context, {"previous_state": "order_driver_assigned"}
                )

        self.assertTrue(result.ok)
        self.assertTrue(execution.deferred)
        orders.return_value.patch_metadata.assert_called_once_with(
            42,
            {
                "driver_cancel": {
                    "previous_state": "order_driver_assigned",
                    "command_instance_id": 77,
                    "outcome": "pending",
                }
            },
        )
        enqueue = outbox.return_value.enqueue.call_args.kwargs
        self.assertEqual(enqueue["event_type"], "set_cancel_state")
        self.assertEqual(enqueue["payload"]["path"], "/drive/get/15867")
        self.assertEqual(enqueue["payload"]["body"], {"action": "set_cancel_state"})
        self.assertEqual(enqueue["idempotency_key"], "taxi-order-42-driver-cancel-77")
        completion = enqueue["completion"]
        self.assertEqual(completion.command_instance_id, 77)
        self.assertEqual(completion.on_sent_trigger, "driver_cancel_confirmed")
        self.assertEqual(completion.on_failed_trigger, "driver_cancel_failed")
        self.assertEqual(completion.process_name, "taxi_order_lifecycle")

    def test_effect_fails_without_core_mapping(self):
        context = _order(TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING, core_order_id=None)
        with patch.object(taxi_effects, "OrderRepository"), patch.object(
            taxi_effects, "CoreOutboxRepository"
        ) as outbox:
            result = taxi_effects.request_core_driver_cancel(
                object(), context, {"previous_state": "order_driver_assigned"}
            )
        self.assertFalse(result.ok)
        outbox.return_value.enqueue.assert_not_called()


# --------------------------------------------------------------------------- #
# Command API: only the assigned driver
# --------------------------------------------------------------------------- #


class _DriverCancelSession(FakeSession):
    """FakeSession that also answers the assigned-driver lookup."""

    def __init__(self, store: Dict[str, Any], orders: Dict[int, tuple]):
        super().__init__(store)
        self.orders = orders

    def execute(self, statement, params=None, *args, **kwargs):
        sql = " ".join(str(statement).split())
        if "FROM orders o" in sql and "core_order_mapping" in sql:
            return _Result(self.orders.get(int(params["order_id"])))
        return super().execute(statement, params, *args, **kwargs)


class DriverCancelCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store: Dict[str, Any] = {
            "idempotency": {},
            "by_instance": {},
            "next_instance_id": 1,
            "last_insert": None,
            "server_instances": {},
        }
        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda *args, **kwargs: True)
        registry.register_command_policy("taxi", "order", can_execute_taxi_order_command)
        self.service = CommandService(
            SnapshotService(registry, lambda: FakeSession(self.store)),
            {"taxi": TaxiIntentCatalog()},
        )
        # order 42: performer 205 in Core mapping, 206 was only a candidate.
        self.orders = {
            42: (205, json.dumps({"mode": "VOTE", "candidates": [{"user_id": 206}]})),
        }

    def _accept(self, principal: Principal, key: str):
        return self.service.accept(
            _DriverCancelSession(self.store, self.orders),
            principal=principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver.order.cancel", key),
        )

    def test_assigned_driver_is_accepted(self):
        result = self._accept(Principal(user_id=205, roles=("driver",)), "k-own")
        self.assertFalse(result.duplicate)
        self.assertEqual(result.response["intent"], "driver_cancel_requested")
        self.assertEqual(result.response["status"], "PENDING")
        self.assertIsInstance(result.response["instanceId"], int)

    def test_other_driver_is_forbidden_before_enqueue(self):
        with self.assertRaisesRegex(AuthorizationError, "cannot execute intent driver_cancel_requested"):
            self._accept(Principal(user_id=206, roles=("driver",)), "k-foreign")
        self.assertEqual(self.store["server_instances"], {})

    def test_taxi_processes_register_the_command_policy(self):
        registry = FsmRegistry()
        register_taxi_processes(registry)
        self.assertIs(
            registry.get_command_policy("taxi", "order"),
            can_execute_taxi_order_command,
        )

    def test_selected_candidate_counts_as_assigned(self):
        self.orders[42] = (None, json.dumps({"selected_candidate": {"user_id": 207}}))
        result = self._accept(Principal(user_id=207, roles=("driver",)), "k-selected")
        self.assertFalse(result.duplicate)

    def test_admin_skips_assigned_driver_check(self):
        self.orders.clear()
        result = self._accept(Principal(user_id=1, roles=("admin",)), "k-admin")
        self.assertFalse(result.duplicate)

    def test_driver_still_cannot_use_passenger_cancel(self):
        with self.assertRaisesRegex(AuthorizationError, "Role cannot execute"):
            self.service.accept(
                _DriverCancelSession(self.store, self.orders),
                principal=Principal(user_id=205, roles=("driver",)),
                service="taxi",
                entity_type="order",
                entity_id=42,
                envelope=_make_envelope("cancel_requested", "k-passenger"),
            )


# --------------------------------------------------------------------------- #
# Entity access: former candidates lose access after assignment
# --------------------------------------------------------------------------- #


class _AccessSession:
    def __init__(self, row):
        self.row = row

    def execute(self, statement, params=None):
        return _Result(self.row)


class OrderAccessTests(unittest.TestCase):
    def _can_access(self, user_id: int, row) -> bool:
        return can_access_taxi_entity(
            _AccessSession(row),
            principal=Principal(user_id=user_id, roles=("driver",)),
            entity_type="order",
            entity_id=42,
        )

    def test_candidate_has_access_while_searching(self):
        row = (100, None, json.dumps({"candidates": [{"user_id": 206}]}), "order_vote_waiting_candidates")
        self.assertTrue(self._can_access(206, row))

    def test_former_candidate_loses_access_after_assignment(self):
        metadata = json.dumps({"candidates": [{"user_id": 205}, {"user_id": 206}]})
        row = (100, 205, metadata, "order_vote_driver_assigned")
        self.assertTrue(self._can_access(205, row))
        self.assertFalse(self._can_access(206, row))

    def test_former_offer_author_loses_access_after_assignment(self):
        metadata = json.dumps(
            {"offers": [{"user_id": 206}], "selected_offer": {"user_id": 205}}
        )
        row = (100, None, metadata, "order_driver_assigned")
        self.assertTrue(self._can_access(205, row))
        self.assertFalse(self._can_access(206, row))

    def test_client_keeps_access(self):
        row = (100, 205, "{}", "order_driver_cancel_pending")
        self.assertTrue(self._can_access(100, row))


class CommandPolicyTests(unittest.TestCase):
    def _can_execute(self, user_id: int, intent: str, row, roles=("driver",)) -> bool:
        return can_execute_taxi_order_command(
            _AccessSession(row),
            principal=Principal(user_id=user_id, roles=roles),
            entity_type="order",
            entity_id=42,
            intent=intent,
        )

    def test_driver_cancel_requires_assigned_driver(self):
        row = (205, json.dumps({"candidates": [{"user_id": 206}]}))
        self.assertTrue(self._can_execute(205, "driver_cancel_requested", row))
        self.assertFalse(self._can_execute(206, "driver_cancel_requested", row))

    def test_unknown_order_is_denied(self):
        self.assertFalse(self._can_execute(205, "driver_cancel_requested", None))

    def test_other_driver_cannot_arrive_and_owner_can_cancel(self):
        row = (205, "{}", 100)
        self.assertFalse(self._can_execute(206, "driver_arrived", row))
        self.assertTrue(self._can_execute(100, "cancel_requested", row, roles=("client",)))


# --------------------------------------------------------------------------- #
# Worker: deferred completion and settling the original command
# --------------------------------------------------------------------------- #


class _WorkerStore:
    def __init__(self) -> None:
        self.instances: List[Dict[str, Any]] = []
        self.commands: Dict[int, Dict[str, Any]] = {}

    def add_instance(self, instance_id: int, trigger_name: str, metadata: Optional[dict] = None):
        self.instances.append(
            {
                "id": instance_id,
                "status": "PENDING",
                "trigger_name": trigger_name,
                "metadata": metadata or {},
            }
        )

    def instance(self, instance_id: int) -> Dict[str, Any]:
        return next(item for item in self.instances if item["id"] == instance_id)


class _NestedTx:
    def commit(self):
        pass

    def rollback(self):
        pass


class _WorkerSession:
    def __init__(self, store: _WorkerStore):
        self.store = store

    def begin_nested(self):
        return _NestedTx()

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}
        if sql.startswith("SELECT id, service, process_name") and "server_fsm_instances" in sql:
            for item in self.store.instances:
                if item["status"] == "PENDING":
                    return _Result(
                        (
                            item["id"], "taxi", "taxi_order_lifecycle", "order", 42,
                            "command", item["trigger_name"], "{}", 205,
                            json.dumps(item["metadata"]),
                        )
                    )
            return _Result(None)
        if sql.startswith("UPDATE server_fsm_instances"):
            item = self.store.instance(int(params["id"]))
            for status in ("PROCESSING", "COMPLETED", "FAILED"):
                if f"instance_status = '{status}'" in sql:
                    item["status"] = status
            return _Result(rowcount=1)
        if sql.startswith("SELECT status FROM fsm_command_idempotency"):
            command = self.store.commands.get(int(params["instance_id"]))
            return _Result((command["status"],) if command else None)
        if sql.startswith("SELECT response_json FROM fsm_command_idempotency"):
            command = self.store.commands.get(int(params["instance_id"]))
            if command is None or command["status"] in (COMPLETED, FAILED):
                return _Result(None)
            return _Result((json.dumps(command["response"]),))
        if sql.startswith("UPDATE fsm_command_idempotency"):
            command = self.store.commands.get(int(params["instance_id"]))
            if command is None or command["status"] in (COMPLETED, FAILED):
                return _Result(rowcount=0)
            command["status"] = params["status"]
            if "response_json" in params:
                command["response"] = json.loads(params["response_json"])
            return _Result(rowcount=1)
        raise AssertionError(f"Unhandled SQL: {sql}")


class _Engine:
    def __init__(self, action):
        self.action = action

    def run_action(self, session, **kwargs):
        self.action(kwargs["trigger"])
        return FsmResult(ok=True, action_name="test", from_state="a", to_state="b")


class DeferredCompletionWorkerTests(unittest.TestCase):
    def _process(self, store: _WorkerStore, action) -> None:
        worker = FsmInstanceWorker(_Engine(action))
        worker.process_next(_WorkerSession(store))

    def test_deferred_command_stays_processing(self):
        store = _WorkerStore()
        store.add_instance(1, "driver_cancel_requested")
        store.commands[1] = {"status": "PENDING", "response": {}}
        seen = []

        self._process(store, lambda trigger: seen.append(defer_current_command_completion()))

        self.assertEqual(seen, [1])
        self.assertEqual(store.instance(1)["status"], "COMPLETED")
        self.assertEqual(store.commands[1]["status"], PROCESSING)

    def test_regular_command_completes_immediately(self):
        store = _WorkerStore()
        store.add_instance(1, "driver_arrived")
        store.commands[1] = {"status": "PENDING", "response": {}}

        self._process(store, lambda trigger: None)

        self.assertEqual(store.commands[1]["status"], COMPLETED)

    def test_confirmation_completes_original_command(self):
        store = _WorkerStore()
        store.commands[1] = {"status": PROCESSING, "response": {}}
        store.add_instance(2, "driver_cancel_confirmed", {"completesCommand": {"instanceId": 1}})

        self._process(store, lambda trigger: None)

        self.assertEqual(store.instance(2)["status"], "COMPLETED")
        self.assertEqual(store.commands[1]["status"], COMPLETED)

    def test_compensation_fails_original_command_with_core_error(self):
        store = _WorkerStore()
        store.commands[1] = {"status": PROCESSING, "response": {}}
        store.add_instance(
            2,
            "driver_cancel_failed",
            {
                "failsCommand": {
                    "instanceId": 1,
                    "errorCode": "INTERNAL_ERROR",
                    "errorMessage": "Core HTTP 500: down",
                }
            },
        )

        self._process(store, lambda trigger: None)

        self.assertEqual(store.commands[1]["status"], FAILED)
        self.assertEqual(store.commands[1]["response"]["errorCode"], "INTERNAL_ERROR")
        self.assertEqual(store.commands[1]["response"]["errorMessage"], "Core HTTP 500: down")

    def test_failed_confirmation_never_reports_completed(self):
        store = _WorkerStore()
        store.commands[1] = {"status": PROCESSING, "response": {}}
        store.add_instance(2, "driver_cancel_confirmed", {"completesCommand": {"instanceId": 1}})

        def fail(trigger):
            raise RuntimeError("state changed")

        self._process(store, fail)

        self.assertEqual(store.commands[1]["status"], FAILED)
        self.assertIn("confirming transition failed", store.commands[1]["response"]["errorMessage"])


# --------------------------------------------------------------------------- #
# Outbox dispatcher: follow-up trigger after final delivery
# --------------------------------------------------------------------------- #


class _OutboxStore:
    def __init__(self, *, attempts: int = 0, max_attempts: int = 8):
        self.status = "PENDING"
        self.attempts = attempts
        self.max_attempts = max_attempts
        self.enqueued: List[Dict[str, Any]] = []


class _OutboxSession:
    completion = {
        "processName": "taxi_order_lifecycle",
        "onSentTrigger": "driver_cancel_confirmed",
        "onFailedTrigger": "driver_cancel_failed",
        "commandInstanceId": 77,
    }

    def __init__(self, store: _OutboxStore):
        self.store = store

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}
        if sql.startswith("SELECT id, service") and "FROM core_outbox" in sql:
            if self.store.status not in ("PENDING", "RETRY"):
                return _Result(None)
            return _Result(
                (
                    9, "taxi", "order", 42, "set_cancel_state",
                    json.dumps({"method": "POST", "path": "/drive/get/15867", "body": {}}),
                    "core_http", self.store.attempts, self.store.max_attempts,
                    "taxi-order-42-driver-cancel-77", json.dumps(self.completion),
                )
            )
        if "SET status = 'PROCESSING'" in sql:
            self.store.status = "PROCESSING"
            self.store.attempts += 1
            return _Result(rowcount=1)
        if "SET status = :status" in sql:
            self.store.status = params["status"]
            return _Result(rowcount=1)
        if sql.startswith("INSERT INTO server_fsm_instances"):
            self.store.enqueued.append(dict(params))
            return _Result(rowcount=1)
        if sql.startswith("SELECT LAST_INSERT_ID()"):
            return _Result((len(self.store.enqueued),))
        # Stale recovery: nothing is stale in these tests.
        return _Result([] if sql.startswith("SELECT") else None, rowcount=0)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class OutboxCompletionTests(unittest.TestCase):
    def _run(self, store: _OutboxStore, handler) -> None:
        handlers = OutboxHandlerRegistry()
        handlers.register("core_http", handler)
        OutboxDispatcher(handlers, retry_base_seconds=1).run_once(
            lambda: _OutboxSession(store), limit=1
        )

    def test_sent_enqueues_confirmation_linked_to_command(self):
        store = _OutboxStore()
        self._run(store, lambda event: DeliveryResult(response={"status": 200}))

        self.assertEqual(store.status, "SENT")
        self.assertEqual(len(store.enqueued), 1)
        follow_up = store.enqueued[0]
        self.assertEqual(follow_up["trigger_name"], "driver_cancel_confirmed")
        self.assertEqual(follow_up["process_name"], "taxi_order_lifecycle")
        self.assertEqual(follow_up["entity_id"], 42)
        self.assertEqual(
            json.loads(follow_up["metadata_json"])["completesCommand"],
            {"instanceId": 77},
        )

    def test_final_failure_enqueues_compensation_with_error(self):
        store = _OutboxStore(max_attempts=1)

        def handler(event):
            raise RuntimeError("Core HTTP 500: down")

        self._run(store, handler)

        self.assertEqual(store.status, "FAILED")
        follow_up = store.enqueued[0]
        self.assertEqual(follow_up["trigger_name"], "driver_cancel_failed")
        fails = json.loads(follow_up["metadata_json"])["failsCommand"]
        self.assertEqual(fails["instanceId"], 77)
        self.assertIn("Core HTTP 500", fails["errorMessage"])

    def test_retry_does_not_settle_the_command(self):
        store = _OutboxStore(max_attempts=3)

        def handler(event):
            raise RuntimeError("temporary")

        self._run(store, handler)

        self.assertEqual(store.status, "RETRY")
        self.assertEqual(store.enqueued, [])


if __name__ == "__main__":
    unittest.main()
