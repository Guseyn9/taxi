"""Driver cancel: failure scenarios.

Each test breaks one link of the chain and checks that the command never
reports a false COMPLETED, nothing is sent to Core twice and the order is not
left in a state that claims a cancellation that did not happen.

    driver app --(HTTP)--> Command API --> worker --> core_outbox
        --(HTTP)--> Core --> follow-up trigger --> worker --> command status
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Dict

from unittest.mock import patch

from domains.taxi import effects as taxi_effects
from domains.taxi.fsm_spec import ORDER_TRANSITIONS, TaxiFsmActions, TaxiFsmStates
from domains.taxi.intents import TaxiIntentCatalog
from domains.taxi.models import Order, OrderMode
from domains.taxi.security import can_execute_taxi_order_command
from fsm_core import FsmRegistry
from fsm_core.command_completion import execution_scope
from fsm_core.command_idempotency import COMPLETED, FAILED, PROCESSING, update_command_status
from fsm_core.command_service import CommandService
from fsm_core.errors import EffectFailed, GuardRejected
from fsm_core.outbox import DeliveryResult, OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.security import Principal
from fsm_core.snapshots import SnapshotService
from fsm_core.workers import FsmInstanceWorker
from test_command_api import FakeSession, _make_envelope, _Result
from test_driver_cancel import (
    _DriverCancelSession,
    _Engine,
    _OutboxSession,
    _OutboxStore,
    _WorkerSession,
    _WorkerStore,
)


DRIVER = Principal(user_id=205, roles=("driver",))


# --------------------------------------------------------------------------- #
# Driver app <-> Command API: response lost, driver taps again
# --------------------------------------------------------------------------- #


class LostResponseTests(unittest.TestCase):
    """The request reached the server, but the driver's app never got 202."""

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
        self.orders = {42: (205, json.dumps({"mode": "DIRECT"}))}

    def _post(self, key: str):
        session = _DriverCancelSession(self.store, self.orders)
        result = self.service.accept(
            session,
            principal=DRIVER,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver.order.cancel", key),
        )
        session.commit()
        return result

    def test_retry_with_same_key_does_not_create_second_command(self):
        first = self._post("cancel-once")
        # Response lost; the app retries the same command.
        second = self._post("cancel-once")

        self.assertTrue(second.duplicate)
        self.assertEqual(second.response["instanceId"], first.response["instanceId"])
        self.assertEqual(len(self.store["server_instances"]), 1)

    def test_retry_while_waiting_for_core_reports_processing_not_completed(self):
        first = self._post("cancel-wait")
        instance_id = first.response["instanceId"]
        # Worker ran the transition and deferred completion until Core answers.
        worker_session = FakeSession(self.store)
        update_command_status(worker_session, instance_id, PROCESSING)

        retry = self._post("cancel-wait")

        self.assertTrue(retry.duplicate)
        self.assertEqual(retry.response["status"], PROCESSING)

    def test_retry_after_core_failure_reports_failed_with_reason(self):
        first = self._post("cancel-failed")
        instance_id = first.response["instanceId"]
        worker_session = FakeSession(self.store)
        update_command_status(worker_session, instance_id, PROCESSING)
        update_command_status(
            worker_session,
            instance_id,
            FAILED,
            error_code="INTERNAL_ERROR",
            error_message="Core HTTP 503: unavailable",
        )

        retry = self._post("cancel-failed")

        self.assertEqual(retry.response["status"], FAILED)
        self.assertEqual(retry.response["errorMessage"], "Core HTTP 503: unavailable")


class PendingOrderIsLockedTests(unittest.TestCase):
    """While Core has not answered, only confirm/revert may move the order.

    Covers a second tap with a new key, the passenger cancelling at the same
    moment, and timers firing while the driver's cancellation is in flight.
    """

    def test_only_confirm_or_revert_leave_pending(self):
        actions_from_pending = {
            t.action
            for t in ORDER_TRANSITIONS
            if t.from_state == TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING
        }
        self.assertEqual(actions_from_pending, set())
        for blocked in (
            TaxiFsmActions.ORDER_CANCEL_BY_DRIVER,
            TaxiFsmActions.ORDER_CANCEL,
            TaxiFsmActions.ORDER_ARRIVE,
            TaxiFsmActions.ORDER_START,
            TaxiFsmActions.ORDER_NO_SHOW,
            TaxiFsmActions.ORDER_EXPIRE,
        ):
            self.assertNotIn(blocked, actions_from_pending, blocked)

    def test_cancelled_order_cannot_be_reverted_or_confirmed_again(self):
        from_cancelled = [
            t for t in ORDER_TRANSITIONS if t.from_state == TaxiFsmStates.ORDER_CANCELLED
        ]
        self.assertEqual(from_cancelled, [])


# --------------------------------------------------------------------------- #
# Worker: transition rejected or crashed
# --------------------------------------------------------------------------- #


def _single_command_store(trigger: str = "driver_cancel_requested") -> _WorkerStore:
    store = _WorkerStore()
    store.add_instance(1, trigger)
    store.commands[1] = {"status": "PENDING", "response": {}}
    return store


def _raise(exc: Exception):
    def action(trigger):
        raise exc

    return action


class WorkerFailureTests(unittest.TestCase):
    def _process(self, store: _WorkerStore, action) -> None:
        FsmInstanceWorker(_Engine(action)).process_next(_WorkerSession(store))

    def test_guard_rejection_fails_command_instead_of_waiting_for_core(self):
        # Second tap with a new key: the order is already pending.
        store = _single_command_store()
        self._process(
            store,
            _raise(GuardRejected("Driver can cancel only a taken order; current state is order_driver_cancel_pending")),
        )

        self.assertEqual(store.instance(1)["status"], "FAILED")
        self.assertEqual(store.commands[1]["status"], FAILED)
        self.assertEqual(store.commands[1]["response"]["errorCode"], "INVALID_TRANSITION")

    def test_effect_failure_fails_command(self):
        # No Core mapping: nothing can be sent, the transaction rolls back.
        store = _single_command_store()
        self._process(store, _raise(EffectFailed("Order #42 has no Core order mapping")))

        self.assertEqual(store.commands[1]["status"], FAILED)
        self.assertIn("no Core order mapping", store.commands[1]["response"]["errorMessage"])

    def test_worker_retry_after_crash_reuses_core_idempotency_key(self):
        # The worker crashed before commit; recovery re-runs the same instance.
        context = Order(
            id=42,
            status=TaxiFsmStates.ORDER_DRIVER_CANCEL_PENDING,
            mode=OrderMode.DIRECT,
            core_order_id=15867,
        )
        keys = []
        for _ in range(2):
            with patch.object(taxi_effects, "OrderRepository"), patch.object(
                taxi_effects, "CoreOutboxRepository"
            ) as outbox:
                with execution_scope(77):
                    taxi_effects.request_core_driver_cancel(
                        object(), context, {"previous_state": "order_driver_assigned"}
                    )
            keys.append(outbox.return_value.enqueue.call_args.kwargs["idempotency_key"])

        # Same key -> core_outbox keeps one row (ON DUPLICATE KEY), Core gets
        # the same Idempotency-Key.
        self.assertEqual(keys[0], keys[1])


class FollowUpFailureTests(unittest.TestCase):
    def _process(self, store: _WorkerStore, action) -> None:
        FsmInstanceWorker(_Engine(action)).process_next(_WorkerSession(store))

    def test_failed_compensation_names_both_failures(self):
        store = _WorkerStore()
        store.commands[1] = {"status": PROCESSING, "response": {}}
        store.add_instance(
            2,
            "driver_cancel_failed",
            {"failsCommand": {"instanceId": 1, "errorMessage": "Core HTTP 503: unavailable"}},
        )

        self._process(store, _raise(ValueError("no revertible driver cancellation")))

        message = store.commands[1]["response"]["errorMessage"]
        self.assertEqual(store.commands[1]["status"], FAILED)
        self.assertIn("Core HTTP 503", message)
        self.assertIn("compensating transition failed", message)

    def test_late_failure_does_not_overwrite_completed_command(self):
        store = _WorkerStore()
        store.commands[1] = {"status": COMPLETED, "response": {}}
        store.add_instance(
            2,
            "driver_cancel_failed",
            {"failsCommand": {"instanceId": 1, "errorMessage": "late"}},
        )

        self._process(store, lambda trigger: None)

        self.assertEqual(store.commands[1]["status"], COMPLETED)

    def test_late_confirmation_does_not_overwrite_failed_command(self):
        store = _WorkerStore()
        store.commands[1] = {"status": FAILED, "response": {"errorCode": "INTERNAL_ERROR"}}
        store.add_instance(2, "driver_cancel_confirmed", {"completesCommand": {"instanceId": 1}})

        self._process(store, lambda trigger: None)

        self.assertEqual(store.commands[1]["status"], FAILED)


# --------------------------------------------------------------------------- #
# Outbox <-> Core: connection lost, Core down, dispatcher crash
# --------------------------------------------------------------------------- #


class _FlakyOutboxSession(_OutboxSession):
    """Outbox session whose finalize can lose the processing lease."""

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        if "SET status = :status" in sql and getattr(self.store, "lease_lost", False):
            return _Result(rowcount=0)
        return super().execute(statement, params)


class CoreConnectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls = []

    def _dispatcher(self, handler) -> OutboxDispatcher:
        handlers = OutboxHandlerRegistry()

        def recording(event):
            self.calls.append(event.idempotency_key)
            return handler(event)

        handlers.register("core_http", recording)
        return OutboxDispatcher(handlers, retry_base_seconds=1)

    def test_temporary_core_outage_retries_then_confirms_once(self):
        store = _OutboxStore(max_attempts=3)
        answers = [RuntimeError("Core timeout"), RuntimeError("Core HTTP 502")]

        def handler(event):
            if answers:
                raise answers.pop(0)
            return DeliveryResult(response={"status": 200})

        dispatcher = self._dispatcher(handler)
        for expected in ("RETRY", "RETRY", "SENT"):
            dispatcher.run_once(lambda: _OutboxSession(store), limit=1)
            self.assertEqual(store.status, expected)
            if expected == "RETRY":
                self.assertEqual(store.enqueued, [], "RETRY must not settle the command")

        self.assertEqual(len(store.enqueued), 1)
        self.assertEqual(store.enqueued[0]["trigger_name"], "driver_cancel_confirmed")
        # Every attempt carries the same Idempotency-Key for Core.
        self.assertEqual(set(self.calls), {"taxi-order-42-driver-cancel-77"})

    def test_core_down_for_all_attempts_reverts_exactly_once(self):
        store = _OutboxStore(max_attempts=3)

        def handler(event):
            raise RuntimeError("Core unreachable")

        dispatcher = self._dispatcher(handler)
        for _ in range(3):
            dispatcher.run_once(lambda: _OutboxSession(store), limit=1)
        # Nothing is claimed after the terminal state.
        dispatcher.run_once(lambda: _OutboxSession(store), limit=1)

        self.assertEqual(store.status, "FAILED")
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(
            [item["trigger_name"] for item in store.enqueued],
            ["driver_cancel_failed"],
        )

    def test_crash_after_core_success_redelivers_same_key_and_confirms_once(self):
        # Core applied the cancel, but the dispatcher lost its lease before
        # writing SENT (process killed, DB connection dropped).
        store = _OutboxStore(max_attempts=8)
        store.lease_lost = True
        dispatcher = self._dispatcher(lambda event: DeliveryResult(response={"status": 200}))

        with self.assertRaises(RuntimeError):
            dispatcher.run_once(lambda: _FlakyOutboxSession(store), limit=1)
        self.assertEqual(store.enqueued, [], "no confirmation without a committed SENT")

        # Stale recovery returns the event to RETRY; delivery is repeated.
        store.lease_lost = False
        store.status = "RETRY"
        dispatcher.run_once(lambda: _FlakyOutboxSession(store), limit=1)

        self.assertEqual(store.status, "SENT")
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0], self.calls[1])
        self.assertEqual(len(store.enqueued), 1)

    def test_expired_lease_with_exhausted_attempts_reverts(self):
        # Dispatcher died mid-delivery on the last attempt; recovery must not
        # leave the command PROCESSING forever.
        store = _OutboxStore()
        completion = json.dumps(_OutboxSession.completion)

        class _StaleSession(_OutboxSession):
            def execute(self, statement, params=None):
                sql = " ".join(str(statement).split())
                if sql.startswith("SELECT id, completion_json"):
                    return _Result([(9, completion, "taxi", "order", 42)])
                return super().execute(statement, params)

        OutboxDispatcher(OutboxHandlerRegistry()).recover_stale(lambda: _StaleSession(store))

        self.assertEqual(len(store.enqueued), 1)
        follow_up = store.enqueued[0]
        self.assertEqual(follow_up["trigger_name"], "driver_cancel_failed")
        fails = json.loads(follow_up["metadata_json"])["failsCommand"]
        self.assertEqual(fails["instanceId"], 77)
        self.assertIn("lease expired", fails["errorMessage"])


if __name__ == "__main__":
    unittest.main()
