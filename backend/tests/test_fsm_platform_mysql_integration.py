from __future__ import annotations

import asyncio
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.orm import sessionmaker

from fsm import FsmProcedureError, call_fsm_action
from fsm_core import (
    DeliveryResult,
    FsmEngine,
    FsmInstanceWorker,
    InMemoryRealtimeHub,
    OutboxDispatcher,
    OutboxHandlerRegistry,
    Principal,
    RealtimePublisher,
    SnapshotService,
    Trigger,
    enqueue_instance_trigger,
    enqueue_outbox_event,
)
from fsm_core.realtime import record_transition_event, realtime_channel
from fsm_worker import build_registry


MYSQL_URL = os.getenv("FSM_TEST_MYSQL_URL")


@unittest.skipUnless(MYSQL_URL, "FSM_TEST_MYSQL_URL is not configured")
class MySqlPlatformIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(MYSQL_URL, pool_pre_ping=True, future=True)
        cls.Session = sessionmaker(
            bind=cls.engine,
            autoflush=False,
            expire_on_commit=False,
        )

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM realtime_events"))
            connection.execute(text("DELETE FROM core_outbox"))
            connection.execute(text("DELETE FROM server_fsm_instances"))
            connection.execute(text("DELETE FROM fsm_action_logs"))
            connection.execute(text("DELETE FROM core_order_mapping"))
            connection.execute(text("DELETE FROM taxi_trips"))
            connection.execute(text("DELETE FROM orders"))

    def _create_vote_order(self, *, client_user_id: int = 100) -> int:
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    INSERT INTO orders (status, description, metadata_json)
                    VALUES (
                        'order_created',
                        'integration vote',
                        JSON_OBJECT(
                            'mode', 'VOTE',
                            'client_user_id', :client_user_id,
                            'candidates', JSON_ARRAY()
                        )
                    )
                    """
                ),
                {"client_user_id": client_user_id},
            )
            order_id = int(result.lastrowid)
            connection.execute(
                text(
                    """
                    INSERT INTO core_order_mapping (
                        local_order_id, client_local_user_id
                    ) VALUES (:order_id, :client_user_id)
                    """
                ),
                {"order_id": order_id, "client_user_id": client_user_id},
            )
        return order_id

    def test_worker_procedure_outbox_realtime_snapshot_lifecycle(self):
        order_id = self._create_vote_order()
        registry = build_registry()
        with self.Session() as session:
            registry.validate_database(session)
            enqueue_instance_trigger(
                session,
                service="taxi",
                process_name="taxi_order_creation",
                entity_type="order",
                entity_id=order_id,
                trigger=Trigger("command", "vote_requested"),
                user_id=100,
            )
            session.commit()

        worker = FsmInstanceWorker(
            FsmEngine(registry, transition_event_recorder=record_transition_event)
        )
        worker_result = worker.run_once(self.Session, limit=10)
        self.assertEqual(worker_result.succeeded, 1)

        with self.Session() as session:
            status = session.execute(
                text("SELECT status FROM orders WHERE id = :id"),
                {"id": order_id},
            ).scalar_one()
            outbox_status = session.execute(
                text("SELECT status FROM core_outbox")
            ).scalar_one()
            realtime_status = session.execute(
                text("SELECT status FROM realtime_events")
            ).scalar_one()
        self.assertEqual(status, "order_vote_waiting_candidates")
        self.assertEqual(outbox_status, "PENDING")
        self.assertEqual(realtime_status, "PENDING")

        delivered = []
        handlers = OutboxHandlerRegistry()
        handlers.register(
            "test_core",
            lambda event: (
                delivered.append(event.idempotency_key)
                or DeliveryResult(response={"accepted": True})
            ),
        )
        outbox_result = OutboxDispatcher(handlers).run_once(self.Session)
        self.assertEqual(outbox_result.succeeded, 1)
        self.assertEqual(delivered, ["integration-publish-vote"])

        async def publish_and_receive():
            hub = InMemoryRealtimeHub()
            publisher = RealtimePublisher(hub)
            channel = realtime_channel("taxi", "order", order_id)
            async with hub.subscribe(channel) as queue:
                result = await publisher.run_once(self.Session)
                return result, await asyncio.wait_for(queue.get(), timeout=2)

        realtime_result, event = asyncio.run(publish_and_receive())
        self.assertEqual(realtime_result.succeeded, 1)
        self.assertEqual(event["payload"]["toState"], "order_vote_waiting_candidates")

        snapshot = SnapshotService(registry, self.Session).build(
            principal=Principal(user_id=100, roles=("client",)),
            service="taxi",
            entity_type="order",
            entity_id=order_id,
        )
        self.assertEqual(snapshot["state"], "order_vote_waiting_candidates")
        self.assertNotIn("metadata", snapshot)

    def test_concurrent_expected_state_allows_only_one_transition(self):
        order_id = self._create_vote_order()
        barrier = threading.Barrier(2)

        def transition():
            session = self.Session()
            try:
                barrier.wait(timeout=5)
                result = call_fsm_action(
                    session,
                    service="taxi",
                    entity_type="order",
                    entity_id=order_id,
                    action_name="order_publish_vote",
                    expected_state="order_created",
                    user_id=100,
                )
                session.commit()
                return result.code
            except FsmProcedureError as exc:
                session.rollback()
                return str(exc).split(":", 1)[0]
            finally:
                session.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: transition(), range(2)))

        self.assertEqual(results.count("OK"), 1)
        self.assertEqual(results.count("TRANSITION_CONFLICT"), 1)

    def test_100_parallel_transitions_split_into_50_successes_and_conflicts(self):
        order_ids = [self._create_vote_order() for _ in range(50)]
        work_items = [
            order_id
            for order_id in order_ids
            for _competing_command in range(2)
        ]
        barrier = threading.Barrier(len(work_items))

        def transition(order_id):
            session = self.Session()
            try:
                barrier.wait(timeout=30)
                result = call_fsm_action(
                    session,
                    service="taxi",
                    entity_type="order",
                    entity_id=order_id,
                    action_name="order_publish_vote",
                    expected_state="order_created",
                    user_id=100,
                )
                session.commit()
                return result.code
            except FsmProcedureError as exc:
                session.rollback()
                return str(exc).split(":", 1)[0]
            finally:
                session.close()

        with ThreadPoolExecutor(max_workers=len(work_items)) as pool:
            results = list(pool.map(transition, work_items))

        self.assertEqual(results.count("OK"), 50)
        self.assertEqual(results.count("TRANSITION_CONFLICT"), 50)

        with self.Session() as session:
            transitioned_orders = session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM orders
                    WHERE id IN :order_ids
                      AND status = 'order_vote_waiting_candidates'
                    """
                ).bindparams(bindparam("order_ids", expanding=True)),
                {"order_ids": order_ids},
            ).scalar_one()
        self.assertEqual(transitioned_orders, 50)

    def test_concurrent_triggers_are_both_persisted(self):
        order_id = self._create_vote_order()
        barrier = threading.Barrier(2)

        def enqueue(name):
            session = self.Session()
            try:
                barrier.wait(timeout=5)
                enqueue_instance_trigger(
                    session,
                    service="taxi",
                    process_name="taxi_order_lifecycle",
                    entity_type="order",
                    entity_id=order_id,
                    trigger=Trigger("command", name),
                    user_id=100,
                )
                session.commit()
            finally:
                session.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(enqueue, ("cancel_requested", "ride_started")))

        with self.Session() as session:
            names = session.execute(
                text(
                    """
                    SELECT trigger_name
                    FROM server_fsm_instances
                    WHERE entity_id = :order_id
                    ORDER BY id
                    """
                ),
                {"order_id": order_id},
            ).scalars().all()
        self.assertCountEqual(names, ["cancel_requested", "ride_started"])

    def test_outbox_idempotency_and_stale_recovery(self):
        order_id = self._create_vote_order()
        with self.Session() as session:
            first = enqueue_outbox_event(
                session,
                service="taxi",
                aggregate_type="order",
                aggregate_id=order_id,
                event_type="test",
                payload={"path": "/test"},
                idempotency_key="same-operation",
                handler_name="test_core",
            )
            second = enqueue_outbox_event(
                session,
                service="taxi",
                aggregate_type="order",
                aggregate_id=order_id,
                event_type="test",
                payload={"path": "/test"},
                idempotency_key="same-operation",
                handler_name="test_core",
            )
            session.commit()
        self.assertEqual(first, second)

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE core_outbox
                    SET status = 'PROCESSING',
                        attempts = 1,
                        locked_by = 'dead-worker',
                        locked_at = :locked_at
                    WHERE id = :id
                    """
                ),
                {
                    "id": first,
                    "locked_at": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1),
                },
            )

        deliveries = []
        handlers = OutboxHandlerRegistry()
        handlers.register(
            "test_core",
            lambda event: (
                deliveries.append(event.id)
                or DeliveryResult(response={"recovered": True})
            ),
        )
        result = OutboxDispatcher(
            handlers,
            lock_timeout_seconds=1,
        ).run_once(self.Session)
        self.assertEqual(result.succeeded, 1)
        self.assertEqual(deliveries, [first])

        with self.Session() as session:
            count = session.execute(
                text(
                    "SELECT COUNT(*) FROM core_outbox "
                    "WHERE idempotency_key = 'same-operation'"
                )
            ).scalar_one()
            status = session.execute(
                text("SELECT status FROM core_outbox WHERE id = :id"),
                {"id": first},
            ).scalar_one()
        self.assertEqual(count, 1)
        self.assertEqual(status, "SENT")

    def test_outbox_retries_after_temporary_failure(self):
        order_id = self._create_vote_order()
        with self.Session() as session:
            event_id = enqueue_outbox_event(
                session,
                service="taxi",
                aggregate_type="order",
                aggregate_id=order_id,
                event_type="temporary_failure",
                payload={"path": "/test"},
                idempotency_key="retry-operation",
                handler_name="test_core",
            )
            session.commit()

        attempts = []
        handlers = OutboxHandlerRegistry()

        def flaky_handler(event):
            attempts.append(event.id)
            if len(attempts) == 1:
                raise RuntimeError("temporary core outage")
            return DeliveryResult(response={"accepted": True})

        handlers.register("test_core", flaky_handler)
        dispatcher = OutboxDispatcher(handlers, retry_base_seconds=1)
        first = dispatcher.run_once(self.Session)
        self.assertEqual(first.failed, 1)

        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE core_outbox
                    SET next_attempt_at = CURRENT_TIMESTAMP
                    WHERE id = :id
                    """
                ),
                {"id": event_id},
            )

        second = dispatcher.run_once(self.Session)
        self.assertEqual(second.succeeded, 1)
        self.assertEqual(attempts, [event_id, event_id])
        with self.Session() as session:
            status = session.execute(
                text("SELECT status FROM core_outbox WHERE id = :id"),
                {"id": event_id},
            ).scalar_one()
        self.assertEqual(status, "SENT")

    def test_driver_snapshot_filters_other_candidates(self):
        order_id = self._create_vote_order()
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE orders
                    SET status = 'order_vote_waiting_candidates', metadata_json = JSON_OBJECT(
                        'mode', 'VOTE',
                        'client_user_id', 100,
                        'candidates', JSON_ARRAY(
                            JSON_OBJECT('user_id', 205, 'price', 500),
                            JSON_OBJECT('user_id', 206, 'price', 450)
                        )
                    )
                    WHERE id = :order_id
                    """
                ),
                {"order_id": order_id},
            )

        snapshot = SnapshotService(build_registry(), self.Session).build(
            principal=Principal(user_id=205, roles=("driver",)),
            service="taxi",
            entity_type="order",
            entity_id=order_id,
        )
        self.assertEqual(
            [candidate["user_id"] for candidate in snapshot["candidates"]],
            [205],
        )
        self.assertEqual(snapshot["availableActions"], [])
        self.assertNotIn("metadata", snapshot)

    def test_fsm_worker_recovers_abandoned_instance(self):
        order_id = self._create_vote_order()
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO server_fsm_instances (
                        service, process_name, entity_type, entity_id,
                        instance_status, trigger_type, trigger_name,
                        attempts_count, locked_by, locked_at
                    ) VALUES (
                        'taxi', 'taxi_order_creation', 'order', :order_id,
                        'PROCESSING', 'command', 'vote_requested',
                        1, 'dead-worker', :locked_at
                    )
                    """
                ),
                {
                    "order_id": order_id,
                    "locked_at": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1),
                },
            )

        worker = FsmInstanceWorker(
            FsmEngine(build_registry()),
            lock_timeout_seconds=1,
        )
        with self.Session() as session:
            recovered = worker.recover_stale(session)
            session.commit()
        self.assertEqual(recovered, 1)

        with self.Session() as session:
            status = session.execute(
                text("SELECT instance_status FROM server_fsm_instances")
            ).scalar_one()
        self.assertEqual(status, "PENDING")


@unittest.skipUnless(
    os.getenv("FSM_TEST_REDIS_URL"),
    "FSM_TEST_REDIS_URL is not configured",
)
class RedisRealtimeIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_hubs_exchange_events(self):
        from fsm_core.realtime import RedisRealtimeHub

        url = os.environ["FSM_TEST_REDIS_URL"]
        first = RedisRealtimeHub.from_url(url, channel_prefix="fsm:test:")
        second = RedisRealtimeHub.from_url(url, channel_prefix="fsm:test:")
        try:
            async with second.subscribe("taxi:order:42") as queue:
                subscribers = await first.publish(
                    "taxi:order:42",
                    {"eventId": 77},
                )
                message = await asyncio.wait_for(queue.get(), timeout=2)
            self.assertGreaterEqual(subscribers, 1)
            self.assertEqual(message["eventId"], 77)
        finally:
            await first.close()
            await second.close()


if __name__ == "__main__":
    unittest.main()
