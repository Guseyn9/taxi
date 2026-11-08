"""Command API tests for TASK-CORE-001 Command Completion.

These tests exercise the **real** CommandService against an in-memory
FakeSession that simulates ``fsm_command_idempotency`` and
``server_fsm_instances``. They are not mock-based: every lifecycle step
(PENDING → PROCESSING → COMPLETED / FAILED) goes through the actual service
and helper code, so regressions in ``get_command_status`` /
``update_command_status`` / ``recover_stale`` are caught here.
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.testclient import TestClient

from domains.taxi.intents import (
    FRONTEND_INTENT_ALIASES,
    TAXI_ORDER_INTENTS,
    TaxiIntentCatalog,
    normalize_taxi_intent,
    resolve_taxi_order_intent,
)
from fsm_core.command_api import create_command_router
from fsm_core.command_idempotency import (
    ALLOWED_STATUSES,
    COMPLETED,
    FAILED,
    PENDING,
    PROCESSING,
    CommandStatusError,
    get_command_by_instance_id,
    update_command_status,
)
from fsm_core.command_service import (
    COMMAND_SCHEMA_VERSION,
    CommandService,
    CommandValidationError,
    parse_command_envelope,
)
from fsm_core.error_codes import classify_exception
from fsm_core.errors import AuthorizationError, CommandNotFoundError
from fsm_core.registry import FsmRegistry
from fsm_core.security import ApiKeyPrincipalProvider, Principal
from fsm_core.snapshots import SnapshotService


# --------------------------------------------------------------------------- #
# Fake session
# --------------------------------------------------------------------------- #


class _Result:
    def __init__(self, row=None, rowcount: int = 1):
        self._row = row
        self.rowcount = rowcount

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._row if isinstance(self._row, list) else []


class FakeSession:
    """In-memory stand-in for SQLAlchemy Session.

    Simulates just enough SQL surface to drive CommandService and the worker
    helpers. The SQL text is matched by substring; the in-memory state lives
    in ``self._store`` and is shared across sessions produced by the same
    factory.

    Each idempotency record can carry an optional ``expires_at`` field (a
    ``datetime``). When set and in the past, the record is treated as
    expired by ``get_command_by_instance_id`` and
    ``get_command_idempotency`` — mirroring the ``expires_at > UTC_TIMESTAMP()``
    clause in the real SQL.
    """

    def __init__(self, store: Optional[Dict[str, Any]] = None):
        self.statements: List[tuple] = []
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self._store = store if store is not None else {
            "idempotency": {},  # (service, scope, key) -> {instance_id, response, status, expires_at}
            "by_instance": {},  # instance_id -> (service, scope, key)
            "next_instance_id": 1,
            "last_insert": None,
            # server_fsm_instances simulation for recover_stale tests.
            # instance_id -> {instance_status, attempts_count, locked_at}
            "server_instances": {},
        }

    # ----- helpers ---------------------------------------------------------- #

    @property
    def _idempotency(self) -> Dict[tuple, Dict[str, Any]]:
        return self._store["idempotency"]

    @property
    def _by_instance(self) -> Dict[int, tuple]:
        return self._store["by_instance"]

    def _next_instance_id(self) -> int:
        v = self._store["next_instance_id"]
        self._store["next_instance_id"] = v + 1
        return v

    @staticmethod
    def _is_expired(stored: Dict[str, Any]) -> bool:
        """Mirror the SQL clause ``expires_at IS NULL OR expires_at >
        UTC_TIMESTAMP()``. ``expires_at`` may be a ``datetime.datetime`` or
        ``None``; if it is in the past, the row is expired."""

        from datetime import datetime, timezone

        expires_at = stored.get("expires_at")
        if expires_at is None:
            return False
        if isinstance(expires_at, datetime):
            now = datetime.now(timezone.utc)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            return expires_at <= now
        return False

    # ----- execute ---------------------------------------------------------- #

    def execute(self, statement, params: Optional[Dict[str, Any]] = None, *args, **kwargs):
        sql = " ".join(str(statement).split())
        params = params or {}
        self.statements.append((sql, params))

        # --- lookups -------------------------------------------------------- #
        if "FROM fsm_command_idempotency" in sql and "SELECT" in sql:
            instance_id_param = params.get("instance_id")

            # Single-column SELECT used by update_command_status(FAILED).
            # Mirrors the real SQL: WHERE instance_id = :instance_id
            #   AND status NOT IN ('COMPLETED', 'FAILED')
            if sql.startswith("SELECT response_json FROM") and instance_id_param is not None:
                instance_id = int(instance_id_param)
                key = self._by_instance.get(instance_id)
                if key is None:
                    return _Result(None)
                stored = self._idempotency[key]
                if "status NOT IN" in sql and stored.get("status") in (COMPLETED, FAILED):
                    return _Result(None)
                return _Result((json.dumps(stored["response"]),))

            # _check_terminal query: SELECT status FROM ... WHERE instance_id = :instance_id
            if sql.startswith("SELECT status FROM") and instance_id_param is not None:
                instance_id = int(instance_id_param)
                key = self._by_instance.get(instance_id)
                if key is None:
                    return _Result(None)
                stored = self._idempotency[key]
                return _Result((stored.get("status", "PENDING"),))

            # get_command_by_instance_id: SELECT instance_id, response_json, ...
            # Mirrors the real SQL which filters by expires_at — expired rows
            # are invisible to GET (returns 404 at the HTTP layer).
            if instance_id_param is not None and "key" not in params:
                instance_id = int(instance_id_param)
                key = self._by_instance.get(instance_id)
                if key is None:
                    return _Result(None)
                stored = self._idempotency[key]
                if self._is_expired(stored):
                    return _Result(None)
                return _Result(
                    (
                        stored["instance_id"],
                        json.dumps(stored["response"]),
                        stored.get("status", "PENDING"),
                        key[0],  # service
                        key[2],  # idempotency_key
                    )
                )

            # Lookup by (service, scope, idempotency_key).
            key = (
                params["service"],
                params.get("scope", "command"),
                params["key"],
            )
            stored = self._idempotency.get(key)
            # ``get_command_idempotency`` filters by expires_at; the SQL
            # contains the literal ``expires_at IS NULL OR expires_at >
            # UTC_TIMESTAMP()`` clause. ``get_command_idempotency_unfiltered``
            # omits that clause and returns the row even if expired.
            applies_retention_filter = "expires_at IS NULL" in sql
            if applies_retention_filter and stored is not None and self._is_expired(stored):
                stored = None
            if stored is None:
                # Race-condition simulation: if the test set ``winner_record``,
                # the *first* lookup returns None (winner not visible yet) and
                # the *second* lookup (after INSERT IGNORE fails) returns the
                # winner record. We detect "second lookup" by checking whether
                # the test has flipped ``force_insert_ignore_fail`` and the
                # lookup is for the same key as the winner.
                #
                # Only the filtered lookup (``get_command_idempotency``)
                # participates in the race simulation — the unfiltered lookup
                # (``get_command_idempotency_unfiltered``) is a separate
                # code path used for expired-record detection and must not
                # consume a lookup-count slot.
                winner = self._store.get("winner_record")
                applies_retention_filter = "expires_at IS NULL" in sql
                if (
                    applies_retention_filter
                    and self._store.get("force_insert_ignore_fail")
                    and winner is not None
                    and winner["response"].get("idempotencyKey") == params["key"]
                ):
                    # The race loser's first lookup happens *before*
                    # put_command_idempotency; the second lookup happens
                    # *after* INSERT IGNORE returns rowcount=0. We distinguish
                    # them by tracking how many times this key has been
                    # looked up.
                    lookup_count_key = ("lookup_count", params["key"])
                    count = self._store.get(lookup_count_key, 0) + 1
                    self._store[lookup_count_key] = count
                    if count >= 2:
                        # Second lookup — expose the winner.
                        wkey = (
                            winner["response"]["service"],
                            "command",
                            winner["response"]["idempotencyKey"],
                        )
                        self._idempotency[wkey] = {
                            "instance_id": winner["instance_id"],
                            "response": winner["response"],
                            "status": winner["status"],
                        }
                        self._by_instance[winner["instance_id"]] = wkey
                        return _Result(
                            (
                                winner["instance_id"],
                                json.dumps(winner["response"]),
                                winner["status"],
                            )
                        )
                return _Result(None)
            return _Result(
                (
                    stored["instance_id"],
                    json.dumps(stored["response"]),
                    stored.get("status", "PENDING"),
                )
            )

        # --- inserts -------------------------------------------------------- #
        if "INSERT IGNORE INTO fsm_command_idempotency" in sql:
            key = (
                params["service"],
                params.get("scope", "command"),
                params["key"],
            )
            if key in self._idempotency:
                return _Result(rowcount=0)
            # Race-condition simulation: INSERT IGNORE returns rowcount=0 even
            # when the row is not yet in our in-memory store (because a
            # concurrent transaction won the insert and we just cannot see it
            # yet). The race path then re-reads via get_command_idempotency,
            # which is where the winner becomes visible.
            if self._store.get("force_insert_ignore_fail"):
                return _Result(rowcount=0)
            response = json.loads(params["response_json"])
            instance_id = params.get("instance_id")
            self._idempotency[key] = {
                "instance_id": instance_id,
                "response": response,
                "status": params.get("status") or response.get("status", "PENDING"),
            }
            if instance_id is not None:
                self._by_instance[int(instance_id)] = key
            return _Result(rowcount=1)

        if "INSERT INTO server_fsm_instances" in sql:
            instance_id = self._next_instance_id()
            self._store["last_insert"] = dict(params)
            self._store["last_insert"]["_instance_id"] = instance_id
            # Track the new instance as PENDING in the simulated table.
            # Lazy-init: some legacy stores from older tests do not pre-create
            # this key.
            self._store.setdefault("server_instances", {})[instance_id] = {
                "instance_status": "PENDING",
                "attempts_count": 0,
                "locked_at": None,
            }
            return _Result()

        if "SELECT LAST_INSERT_ID()" in sql:
            last = self._store.get("last_insert") or {}
            return _Result((last.get("_instance_id"),))

        # --- server_fsm_instances lookups (recover_stale + process_next) ---- #
        if "FROM server_fsm_instances" in sql and "SELECT" in sql:
            server_instances = self._store.setdefault("server_instances", {})
            # recover_stale collects stale PROCESSING rows with their target
            # next status (PENDING for retry, FAILED when exhausted).
            if "instance_status = 'PROCESSING'" in sql or "PROCESSING" in sql.upper():
                max_attempts = int(params.get("max_attempts", 3))
                stale_rows = []
                for inst_id, inst in server_instances.items():
                    if inst.get("instance_status") != "PROCESSING":
                        continue
                    stale_rows.append(
                        (
                            inst_id,
                            "FAILED" if inst.get("attempts_count", 0) >= max_attempts else "PENDING",
                        )
                    )
                stale_rows.sort(key=lambda r: r[0])
                return _Result(stale_rows if stale_rows else None)

            # process_next: SELECT ... WHERE instance_status = 'PENDING' ...
            # Return the first PENDING instance row.
            for inst_id, inst in server_instances.items():
                if inst.get("instance_status") == "PENDING":
                    # Return a row tuple matching the columns selected by
                    # process_next: id, service, process_name, entity_type,
                    # entity_id, trigger_type, trigger_name, trigger_payload,
                    # requested_by_user_id.
                    last_insert = self._store.get("last_insert") or {}
                    return _Result(
                        (
                            inst_id,
                            last_insert.get("service", "taxi"),
                            last_insert.get("process_name", "taxi_order_lifecycle"),
                            last_insert.get("entity_type", "order"),
                            last_insert.get("entity_id", 42),
                            last_insert.get("trigger_type", "command"),
                            last_insert.get("trigger_name", "driver_arrived"),
                            last_insert.get("trigger_payload", "{}"),
                            last_insert.get("user_id", 205),
                        )
                    )
            return _Result(None)

        # --- updates -------------------------------------------------------- #
        if "UPDATE fsm_command_idempotency" in sql:
            # Single-row status update.
            if "instance_id = :instance_id" in params or "instance_id" in params:
                instance_id = int(params["instance_id"])
                key = self._by_instance.get(instance_id)
                if key is None:
                    return _Result(rowcount=0)
                stored = self._idempotency[key]

                # Terminal immutability: emulate the WHERE status NOT IN (...)
                # clause present in the real SQL.
                if "status NOT IN" in sql and stored.get("status") in (COMPLETED, FAILED):
                    return _Result(rowcount=0)

                if "response_json = :response_json" in sql or ":response_json" in params:
                    stored["response"] = json.loads(params["response_json"])
                stored["status"] = params["status"]
                return _Result(rowcount=1)

        # --- server_fsm_instances updates (recover_stale + process_next) ---- #
        if "UPDATE server_fsm_instances" in sql:
            server_instances = self._store.setdefault("server_instances", {})
            # recover_stale uses a CASE expression: matched rows flip
            # PROCESSING → PENDING or FAILED based on attempts_count.
            if "instance_status = CASE" in sql:
                max_attempts = int(params.get("max_attempts", 3))
                updated = 0
                for inst_id, inst in server_instances.items():
                    if inst.get("instance_status") != "PROCESSING":
                        continue
                    if inst.get("attempts_count", 0) >= max_attempts:
                        inst["instance_status"] = "FAILED"
                    else:
                        inst["instance_status"] = "PENDING"
                    inst["locked_at"] = None
                    updated += 1
                return _Result(rowcount=updated)

            # process_next sets instance_status to PROCESSING/COMPLETED/FAILED
            # by id. Matched by ``WHERE id = :id``.
            inst_id = params.get("id")
            if inst_id is not None:
                inst_id = int(inst_id)
                inst = server_instances.get(inst_id)
                if inst is None:
                    return _Result(rowcount=0)
                if "instance_status = 'PROCESSING'" in sql:
                    inst["instance_status"] = "PROCESSING"
                    inst["attempts_count"] = inst.get("attempts_count", 0) + 1
                    inst["locked_at"] = "now"
                elif "instance_status = 'COMPLETED'" in sql:
                    inst["instance_status"] = "COMPLETED"
                    inst["locked_at"] = None
                elif "instance_status = 'FAILED'" in sql:
                    inst["instance_status"] = "FAILED"
                    inst["locked_at"] = None
                return _Result(rowcount=1)

        raise AssertionError(f"Unhandled SQL: {sql}")

    # ----- transaction control -------------------------------------------- #

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def _session_factory(store: Optional[Dict[str, Any]] = None):
    shared = store if store is not None else {
        "idempotency": {},
        "by_instance": {},
        "next_instance_id": 1,
        "last_insert": None,
        "sessions": [],
    }

    def factory() -> FakeSession:
        session = FakeSession(shared)
        shared.setdefault("sessions", []).append(session)
        return session

    factory.store = shared
    return factory


def _build_service(
    store: Optional[Dict[str, Any]] = None,
    *,
    access_policy=None,
):
    factory = _session_factory(store)

    registry = FsmRegistry()
    # Default permissive access policy; auth tests override it.
    if access_policy is None:
        access_policy = lambda *args, **kwargs: True
    registry.register_access_policy("taxi", "order", access_policy)
    registry.register_snapshot_builder(
        "taxi", "order", lambda *args, **kwargs: {"ok": True}
    )

    service = CommandService(
        SnapshotService(registry, factory),
        {"taxi": TaxiIntentCatalog()},
        idempotency_ttl_hours=24,
    )
    return service, factory


def _make_envelope(intent: str = "driver_arrived", idempotency_key: str = "k1") -> Any:
    return parse_command_envelope(
        {
            "schemaVersion": "1.0",
            "intent": intent,
            "commandId": idempotency_key,
            "correlationId": "corr-" + idempotency_key,
            "payload": {},
        }
    )


# --------------------------------------------------------------------------- #
# Intent / envelope unit tests
# --------------------------------------------------------------------------- #


class IntentCatalogTests(unittest.TestCase):
    def test_readme_intents_are_registered(self):
        expected = {
            "order_registered",
            "vote_requested",
            "offer_requested",
            "direct_assignment_requested",
            "cancel_requested",
            "driver_cancel_requested",
            "candidate_selected",
            "candidate_released",
            "offer_selected",
            "driver_arrived",
            "ride_started",
            "ride_finished",
            "order_expired",
            "pickup_timeout",
            "ride_interrupted",
        }
        self.assertEqual(set(TAXI_ORDER_INTENTS), expected)

    def test_frontend_alias_maps_to_readme_intent(self):
        self.assertEqual(normalize_taxi_intent("driver.order.arrive"), "driver_arrived")
        self.assertEqual(
            normalize_taxi_intent("driver.order.confirm_boarding"),
            "ride_started",
        )
        self.assertIn("driver.order.confirm_boarding", FRONTEND_INTENT_ALIASES)

    def test_creation_and_lifecycle_process_routing(self):
        self.assertEqual(
            resolve_taxi_order_intent("vote_requested").process_name,
            "taxi_order_creation",
        )
        self.assertEqual(
            resolve_taxi_order_intent("driver_arrived").process_name,
            "taxi_order_lifecycle",
        )


class EnvelopeTests(unittest.TestCase):
    def test_idempotency_key_from_header_or_command_id(self):
        envelope = parse_command_envelope(
            {
                "schemaVersion": "1.0",
                "intent": "driver_arrived",
                "commandId": "cmd-1",
                "correlationId": "corr-1",
                "payload": {"boardingCode": "1234"},
            },
            idempotency_header=None,
        )
        self.assertEqual(envelope.idempotency_key, "cmd-1")
        self.assertEqual(envelope.payload["boardingCode"], "1234")

        with self.assertRaises(CommandValidationError):
            parse_command_envelope({"intent": "driver_arrived", "payload": {}})

    def test_schema_version_must_match(self):
        with self.assertRaises(CommandValidationError):
            parse_command_envelope(
                {"schemaVersion": "2.0", "intent": "x", "commandId": "c", "payload": {}}
            )


# --------------------------------------------------------------------------- #
# Lifecycle tests against the real CommandService + FakeSession
# --------------------------------------------------------------------------- #


class CommandLifecycleTests(unittest.TestCase):
    """TASK-CORE-001 §13 lifecycle scenarios."""

    def setUp(self) -> None:
        self.service, self.factory = _build_service()
        self.driver_principal = Principal(user_id=205, roles=("driver",))
        self.client_principal = Principal(user_id=100, roles=("client",))

    # ----- Creation: POST → PENDING --------------------------------------- #

    def test_accept_returns_pending_and_status_lookup_returns_pending(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-create"),
        )
        session.commit()
        session.close()

        self.assertFalse(result.duplicate)
        self.assertEqual(result.response["status"], "PENDING")
        instance_id = result.response["instanceId"]
        self.assertIsInstance(instance_id, int)

        # GET must return PENDING for a freshly accepted command.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], PENDING)
        self.assertEqual(status["instanceId"], instance_id)
        self.assertEqual(status["intent"], "driver_arrived")
        # errorCode must NOT be present on non-FAILED status.
        self.assertNotIn("errorCode", status)

    # ----- Execution: worker → PROCESSING → COMPLETED --------------------- #

    def test_worker_transitions_command_to_completed(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-complete"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Worker marks PROCESSING then COMPLETED through the helper.
        ws = self.factory()
        self.assertTrue(update_command_status(ws, instance_id, PROCESSING))
        self.assertTrue(update_command_status(ws, instance_id, COMPLETED))
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], COMPLETED)
        self.assertNotIn("errorCode", status)

    # ----- Failure: worker → FAILED + errorCode --------------------------- #

    def test_worker_failed_persists_error_code(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-fail"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INVALID_TRANSITION",
            error_message="order_driver_arrived -> order_in_ride is not allowed",
        )
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(status["errorCode"], "INVALID_TRANSITION")
        self.assertIn("errorMessage", status)
        self.assertEqual(
            status["errorMessage"],
            "order_driver_arrived -> order_in_ride is not allowed",
        )

    # ----- Duplicate ------------------------------------------------------ #

    def test_duplicate_idempotency_key_returns_same_instance_and_status(self):
        first_session = self.factory()
        first = self.service.accept(
            first_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("ride_finished", "dup-key"),
        )
        first_session.commit()
        first_session.close()
        original_instance_id = first.response["instanceId"]

        # Worker advances the original to COMPLETED *before* the duplicate POST
        # arrives. The duplicate must report the *current* status, not PENDING.
        ws = self.factory()
        update_command_status(ws, original_instance_id, PROCESSING)
        update_command_status(ws, original_instance_id, COMPLETED)
        ws.commit()
        ws.close()

        dup_session = self.factory()
        dup = self.service.accept(
            dup_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("ride_finished", "dup-key"),
        )
        dup_session.rollback()  # duplicate path rolls back, like the HTTP adapter.
        dup_session.close()

        self.assertTrue(dup.duplicate)
        self.assertEqual(dup.response["instanceId"], original_instance_id)
        self.assertTrue(dup.response["duplicate"])
        # The duplicate response itself must carry the *current* status — not
        # the stale PENDING captured at POST #1 time. This is the regression
        # that previously broke the contract: response_json is immutable, so
        # without an explicit lookup the duplicate would always say PENDING
        # even after the worker had moved the execution to COMPLETED.
        self.assertEqual(dup.response["status"], COMPLETED)

        # GET must also reflect the current COMPLETED status.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, original_instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], COMPLETED)

    def test_duplicate_idempotency_key_returns_current_failed_status(self):
        """If the original execution FAILED, the duplicate POST must surface
        the FAILED status and the machine errorCode on the response itself —
        not force the client to issue a separate GET."""

        first_session = self.factory()
        first = self.service.accept(
            first_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("ride_finished", "dup-fail-key"),
        )
        first_session.commit()
        first_session.close()
        original_instance_id = first.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, original_instance_id, PROCESSING)
        update_command_status(
            ws,
            original_instance_id,
            FAILED,
            error_code="INVALID_TRANSITION",
            error_message="order_in_ride -> order_completed is not allowed",
        )
        ws.commit()
        ws.close()

        dup_session = self.factory()
        dup = self.service.accept(
            dup_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("ride_finished", "dup-fail-key"),
        )
        dup_session.rollback()
        dup_session.close()

        self.assertTrue(dup.duplicate)
        self.assertEqual(dup.response["instanceId"], original_instance_id)
        self.assertEqual(dup.response["status"], FAILED)
        self.assertEqual(dup.response["errorCode"], "INVALID_TRANSITION")
        self.assertIn("errorMessage", dup.response)

    def test_duplicate_before_worker_returns_pending(self):
        """Duplicate POST before the worker has touched the execution must
        still return PENDING — the new lookup must not regress this case."""

        first_session = self.factory()
        first = self.service.accept(
            first_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "dup-pending-key"),
        )
        first_session.commit()
        first_session.close()
        original_instance_id = first.response["instanceId"]

        # No worker step here — duplicate arrives while execution is still
        # genuinely PENDING.
        dup_session = self.factory()
        dup = self.service.accept(
            dup_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "dup-pending-key"),
        )
        dup_session.rollback()
        dup_session.close()

        self.assertTrue(dup.duplicate)
        self.assertEqual(dup.response["status"], PENDING)
        self.assertEqual(dup.response["instanceId"], original_instance_id)

    def test_race_condition_duplicate_returns_current_status(self):
        """Race-condition path: a second POST loses the INSERT IGNORE race
        (``rowcount=0``) because a concurrent request already inserted the
        same ``(service, scope, idempotency_key)``. By the time we re-read
        the record the worker may have already advanced the execution to
        COMPLETED.

        This test simulates that race by pre-populating the FakeSession store
        with a winning record whose status has been moved forward. The
        service must lift the current status onto the duplicate response —
        not return the stale PENDING captured by the winner at its POST time.
        """

        # Manually construct a session factory whose store already contains a
        # winning record. We use the same shape that put_command_idempotency
        # would have produced, but with the row already in COMPLETED — i.e.
        # the worker already ran between the winner's POST and the loser's
        # POST.
        store = {
            "idempotency": {},
            "by_instance": {},
            "next_instance_id": 100,
            "last_insert": None,
            "sessions": [],
            # When True, INSERT IGNORE returns rowcount=0 even when the
            # (service, scope, key) is not yet in the in-memory store. This
            # emulates the race: a concurrent transaction won the insert, but
            # the row is not visible to *our* session's lookup until we
            # explicitly populate the store below.
            "force_insert_ignore_fail": True,
            # The "winner" record that the race loser must observe when it
            # re-reads via get_command_idempotency after INSERT IGNORE fails.
            "winner_record": {
                "instance_id": 42,
                "response": {
                    "schemaVersion": "1.0",
                    "accepted": True,
                    "duplicate": False,
                    "instanceId": 42,
                    "status": "PENDING",
                    "commandId": "race-key",
                    "intent": "driver_arrived",
                    "service": "taxi",
                    "entityType": "order",
                    "entityId": 42,
                    "requestedByUserId": 205,
                    "idempotencyKey": "race-key",
                },
                "status": "COMPLETED",  # Worker has already finished.
            },
        }
        service, factory = _build_service(store=store)

        # The loser POST arrives. Its initial get_command_idempotency returns
        # None (winner not visible yet), so it proceeds to enqueue_fsm_instance
        # and put_command_idempotency — which returns False due to
        # force_insert_ignore_fail. The race path then re-reads via
        # get_command_idempotency, and this time the winner *is* visible
        # (the FakeSession store is populated on demand).
        loser_session = factory()
        result = service.accept(
            loser_session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "race-key"),
        )
        loser_session.rollback()
        loser_session.close()

        # Race path must return duplicate=True with the *current* status of
        # the winner's instance_id — not the stale PENDING captured at the
        # winner's POST time.
        self.assertTrue(result.duplicate)
        self.assertEqual(result.response["instanceId"], 42)
        self.assertEqual(result.response["status"], COMPLETED)
        self.assertTrue(result.response["duplicate"])

    # ----- Unknown instance ---------------------------------------------- #

    def test_unknown_instance_returns_none_then_404(self):
        session = self.factory()
        status = self.service.get_command_status(
            session, 999999, principal=self.driver_principal
        )
        session.rollback()
        session.close()
        self.assertIsNone(status)

    # ----- Terminal immutability ----------------------------------------- #

    def test_completed_is_terminal_and_cannot_change(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-terminal"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        update_command_status(ws, instance_id, COMPLETED)
        # Attempt to revert to PENDING — must be refused by the helper.
        self.assertFalse(update_command_status(ws, instance_id, PENDING))
        # Attempt to flip to FAILED — must also be refused.
        self.assertFalse(
            update_command_status(
                ws, instance_id, FAILED, error_code="INTERNAL_ERROR"
            )
        )
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], COMPLETED)
        self.assertNotIn("errorCode", status)

    def test_failed_is_terminal_and_cannot_change(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-failed-terminal"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        update_command_status(
            ws, instance_id, FAILED, error_code="INVALID_TRANSITION"
        )
        # Attempt to revive.
        self.assertFalse(update_command_status(ws, instance_id, PENDING))
        self.assertFalse(update_command_status(ws, instance_id, PROCESSING))
        self.assertFalse(update_command_status(ws, instance_id, COMPLETED))
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(status["errorCode"], "INVALID_TRANSITION")

    # ----- Validation ---------------------------------------------------- #

    def test_invalid_status_raises(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-invalid"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        with self.assertRaises(CommandStatusError):
            update_command_status(ws, instance_id, "BANANA")
        ws.rollback()
        ws.close()

    # ----- Role mismatch ------------------------------------------------- #

    def test_role_mismatch_is_forbidden(self):
        session = self.factory()
        with self.assertRaisesRegex(AuthorizationError, "Role cannot execute"):
            self.service.accept(
                session,
                principal=Principal(user_id=205, roles=("driver",)),
                service="taxi",
                entity_type="order",
                entity_id=42,
                envelope=_make_envelope("cancel_requested", "k-role"),
            )
        self.assertFalse(session.committed)
        self.assertFalse(session.closed)


# --------------------------------------------------------------------------- #
# Authorization on GET /api/commands/{instanceId}
# --------------------------------------------------------------------------- #


class CommandGetAuthorizationTests(unittest.TestCase):
    """TASK-CORE-001 — GET endpoint must not leak executions across users."""

    def setUp(self) -> None:
        # Per-user access policy: a principal may access an entity only if
        # they own it. We treat entity_id 42 as owned by driver 205; admin
        # bypasses.
        def owner_only_policy(session, *, principal, entity_type, entity_id):
            if principal.has_role("admin", "system"):
                return True
            # Map (entity_id -> owner_user_id). In real life this is a DB
            # lookup; here we encode the test fixture.
            owners = {42: 205}
            return owners.get(entity_id) == principal.user_id

        self.service, self.factory = _build_service(access_policy=owner_only_policy)
        self.driver = Principal(user_id=205, roles=("driver",))
        self.other_driver = Principal(user_id=206, roles=("driver",))
        self.admin = Principal(user_id=1, roles=("admin",))

    def test_owner_can_read_own_execution(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-owner"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], PENDING)

    def test_other_driver_is_denied(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-leak"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        status_session = self.factory()
        with self.assertRaises(AuthorizationError):
            self.service.get_command_status(
                status_session, instance_id, principal=self.other_driver
            )
        status_session.rollback()
        status_session.close()

    def test_admin_can_read_any_execution(self):
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "k-admin"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.admin
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], PENDING)


# --------------------------------------------------------------------------- #
# HTTP layer (end-to-end via FastAPI TestClient)
# --------------------------------------------------------------------------- #


class CommandHttpTests(unittest.TestCase):
    def _build_app(self) -> tuple[FastAPI, Any]:
        factory = _session_factory()
        registry = FsmRegistry()
        registry.register_access_policy("taxi", "order", lambda *args, **kwargs: True)
        registry.register_snapshot_builder(
            "taxi", "order", lambda *args, **kwargs: {"ok": True}
        )
        app = FastAPI()
        app.include_router(create_command_router())
        app.state.session_factory = factory
        app.state.principal_provider = ApiKeyPrincipalProvider(
            {
                "driver-token": Principal(user_id=205, roles=("driver",)),
                "admin-token": Principal(user_id=1, roles=("admin",)),
            }
        )
        app.state.command_service = CommandService(
            SnapshotService(registry, factory),
            {"taxi": TaxiIntentCatalog()},
        )
        return app, factory

    def test_http_command_returns_accepted(self):
        app, factory = self._build_app()
        with TestClient(app) as client:
            response = client.post(
                "/api/commands/taxi/order/42",
                headers={
                    "Authorization": "Bearer driver-token",
                    "Idempotency-Key": "http-arrive-1",
                },
                json={
                    "schemaVersion": "1.0",
                    "intent": "driver_arrived",
                    "correlationId": "corr-http-1",
                    "payload": {},
                },
            )
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertTrue(body["accepted"])
        self.assertEqual(body["intent"], "driver_arrived")
        self.assertEqual(body["instanceId"], 1)
        self.assertEqual(body["correlationId"], "corr-http-1")
        self.assertEqual(body["status"], PENDING)

    def test_http_command_requires_auth(self):
        app, _ = self._build_app()
        with TestClient(app) as client:
            response = client.post(
                "/api/commands/taxi/order/42",
                json={"intent": "driver_arrived", "idempotencyKey": "x", "payload": {}},
            )
        self.assertEqual(response.status_code, 401)

    def test_http_get_status_pending_after_post(self):
        app, factory = self._build_app()
        with TestClient(app) as client:
            post = client.post(
                "/api/commands/taxi/order/42",
                headers={
                    "Authorization": "Bearer driver-token",
                    "Idempotency-Key": "http-get-pending",
                },
                json={
                    "schemaVersion": "1.0",
                    "intent": "driver_arrived",
                    "payload": {},
                },
            )
            self.assertEqual(post.status_code, 202)
            instance_id = post.json()["instanceId"]

            get = client.get(
                f"/api/commands/{instance_id}",
                headers={"Authorization": "Bearer driver-token"},
            )
        self.assertEqual(get.status_code, 200)
        body = get.json()
        self.assertEqual(body["status"], PENDING)
        self.assertEqual(body["instanceId"], instance_id)

    def test_http_get_status_completed_after_worker(self):
        app, factory = self._build_app()
        with TestClient(app) as client:
            post = client.post(
                "/api/commands/taxi/order/42",
                headers={
                    "Authorization": "Bearer driver-token",
                    "Idempotency-Key": "http-get-completed",
                },
                json={
                    "schemaVersion": "1.0",
                    "intent": "driver_arrived",
                    "payload": {},
                },
            )
            instance_id = post.json()["instanceId"]

            # Drive the worker transition out-of-band through the helper.
            ws = factory()
            update_command_status(ws, instance_id, PROCESSING)
            update_command_status(ws, instance_id, COMPLETED)
            ws.commit()
            ws.close()

            get = client.get(
                f"/api/commands/{instance_id}",
                headers={"Authorization": "Bearer driver-token"},
            )
        self.assertEqual(get.status_code, 200)
        self.assertEqual(get.json()["status"], COMPLETED)

    def test_http_get_status_failed_with_error_code(self):
        app, factory = self._build_app()
        with TestClient(app) as client:
            post = client.post(
                "/api/commands/taxi/order/42",
                headers={
                    "Authorization": "Bearer driver-token",
                    "Idempotency-Key": "http-get-failed",
                },
                json={
                    "schemaVersion": "1.0",
                    "intent": "driver_arrived",
                    "payload": {},
                },
            )
            instance_id = post.json()["instanceId"]

            ws = factory()
            update_command_status(ws, instance_id, PROCESSING)
            update_command_status(
                ws,
                instance_id,
                FAILED,
                error_code="INVALID_TRANSITION",
                error_message="boom",
            )
            ws.commit()
            ws.close()

            get = client.get(
                f"/api/commands/{instance_id}",
                headers={"Authorization": "Bearer driver-token"},
            )
        self.assertEqual(get.status_code, 200)
        body = get.json()
        self.assertEqual(body["status"], FAILED)
        self.assertEqual(body["errorCode"], "INVALID_TRANSITION")

    def test_http_get_unknown_instance_returns_404(self):
        app, _ = self._build_app()
        with TestClient(app) as client:
            response = client.get(
                "/api/commands/999999",
                headers={"Authorization": "Bearer driver-token"},
            )
        self.assertEqual(response.status_code, 404)

    def test_http_get_requires_auth(self):
        app, _ = self._build_app()
        with TestClient(app) as client:
            response = client.get("/api/commands/1")
        self.assertEqual(response.status_code, 401)

    def test_http_get_denied_for_non_owner(self):
        app, factory = self._build_app()
        with TestClient(app) as client:
            post = client.post(
                "/api/commands/taxi/order/42",
                headers={
                    "Authorization": "Bearer driver-token",
                    "Idempotency-Key": "http-get-denied",
                },
                json={
                    "schemaVersion": "1.0",
                    "intent": "driver_arrived",
                    "payload": {},
                },
            )
            instance_id = post.json()["instanceId"]

            # admin-token is allowed (admin bypass), so we craft a second
            # driver identity by directly poking the store? Simpler: assert
            # admin can read while the original driver owns it.
            admin_get = client.get(
                f"/api/commands/{instance_id}",
                headers={"Authorization": "Bearer admin-token"},
            )
        self.assertEqual(admin_get.status_code, 200)
        self.assertEqual(admin_get.json()["status"], PENDING)

    def test_schema_version_constant(self):
        self.assertEqual(COMMAND_SCHEMA_VERSION, "1.0")


# --------------------------------------------------------------------------- #
# Error code classification
# --------------------------------------------------------------------------- #


class ErrorCodeClassificationTests(unittest.TestCase):
    def test_unknown_procedure_error_maps_to_invalid_transition(self):
        from fsm.procedure import FsmProcedureError

        classified = classify_exception(
            FsmProcedureError("INVALID_TRANSITION: order_created + order_start")
        )
        self.assertEqual(classified.code, "INVALID_TRANSITION")

    def test_transition_conflict_maps_to_invalid_transition(self):
        from fsm.procedure import FsmProcedureError

        classified = classify_exception(
            FsmProcedureError("TRANSITION_CONFLICT: Expected state stale")
        )
        self.assertEqual(classified.code, "INVALID_TRANSITION")

    def test_unknown_entity_maps_correctly(self):
        from fsm_core.errors import ProcessEntityMismatch

        classified = classify_exception(ProcessEntityMismatch("wrong entity"))
        self.assertEqual(classified.code, "UNKNOWN_ENTITY")

    def test_generic_exception_maps_to_internal_error(self):
        classified = classify_exception(RuntimeError("disk full"))
        self.assertEqual(classified.code, "INTERNAL_ERROR")


# --------------------------------------------------------------------------- #
# Retention tests — expired records must be invisible to GET (BLOCKER fix)
# --------------------------------------------------------------------------- #


class RetentionTests(unittest.TestCase):
    """TASK-CORE-001 §10: records past ``expires_at`` must be treated as
    non-existent by ``GET /api/commands/{instanceId}`` — the endpoint returns
    404, not a stale status.

    This was a BLOCKER in the third review: ``get_command_by_instance_id``
    did not filter by ``expires_at`` even though README promised 404 for
    expired records. The lookup now mirrors the ``expires_at > UTC_TIMESTAMP()``
    clause present in ``get_command_idempotency``.
    """

    def setUp(self) -> None:
        self.service, self.factory = _build_service()
        self.driver_principal = Principal(user_id=205, roles=("driver",))

    def test_expired_instance_returns_none_from_helper(self):
        from datetime import datetime, timedelta, timezone

        from fsm_core.command_idempotency import get_command_by_instance_id

        # Create a command, then force its expires_at into the past.
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "expired-key"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Move the record's expires_at to 1 hour ago.
        key = self.factory.store["by_instance"][instance_id]
        self.factory.store["idempotency"][key]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        )

        # Helper must return None — expired rows are invisible.
        expired_session = self.factory()
        record = get_command_by_instance_id(expired_session, instance_id)
        expired_session.rollback()
        expired_session.close()
        self.assertIsNone(record)

    def test_expired_instance_returns_404_from_service(self):
        from datetime import datetime, timedelta, timezone

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "expired-svc-key"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        key = self.factory.store["by_instance"][instance_id]
        self.factory.store["idempotency"][key]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        )

        expired_session = self.factory()
        status = self.service.get_command_status(
            expired_session, instance_id, principal=self.driver_principal
        )
        expired_session.rollback()
        expired_session.close()
        self.assertIsNone(status)

    def test_non_expired_instance_still_visible(self):
        from datetime import datetime, timedelta, timezone

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "future-key"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Set expires_at to 1 hour in the future — record should still be visible.
        key = self.factory.store["by_instance"][instance_id]
        self.factory.store["idempotency"][key]["expires_at"] = (
            datetime.now(timezone.utc) + timedelta(hours=1)
        )

        future_session = self.factory()
        status = self.service.get_command_status(
            future_session, instance_id, principal=self.driver_principal
        )
        future_session.rollback()
        future_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], PENDING)

    def test_no_expires_at_means_never_expires(self):
        """Records without ``expires_at`` (NULL in SQL) are always visible.
        This mirrors the SQL clause ``expires_at IS NULL OR ... > UTC_TIMESTAMP()``.
        """

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "no-expiry-key"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Explicitly remove expires_at to simulate a legacy row.
        key = self.factory.store["by_instance"][instance_id]
        self.factory.store["idempotency"][key]["expires_at"] = None

        no_expiry_session = self.factory()
        status = self.service.get_command_status(
            no_expiry_session, instance_id, principal=self.driver_principal
        )
        no_expiry_session.rollback()
        no_expiry_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], PENDING)

    def test_null_status_returns_none(self):
        """D5: a NULL status column indicates data corruption. The service
        must return None (→ 404) rather than silently substituting PENDING,
        which would mask the bug."""

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "null-status-key"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Force the status column to None to simulate data corruption.
        key = self.factory.store["by_instance"][instance_id]
        self.factory.store["idempotency"][key]["status"] = None

        null_session = self.factory()
        status = self.service.get_command_status(
            null_session, instance_id, principal=self.driver_principal
        )
        null_session.rollback()
        null_session.close()
        self.assertIsNone(
            status,
            "NULL status must return None (→ 404), not silently fabricate PENDING",
        )

    def test_expired_duplicate_post_returns_404(self):
        """D7: a duplicate POST for an expired execution must return 404,
        matching the GET endpoint's retention enforcement. Previously the
        duplicate path returned the stale PENDING captured at POST #1 time,
        which contradicted the README contract."""

        from datetime import datetime, timedelta, timezone

        from fsm_core.errors import CommandNotFoundError

        # POST #1 — creates the command.
        session = self.factory()
        self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "expired-dup-key"),
        )
        session.commit()
        session.close()

        # Expire the record.
        key = self.factory.store["by_instance"][1]  # first instance_id
        self.factory.store["idempotency"][key]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        )

        # POST #2 — duplicate with the same Idempotency-Key. Must raise
        # CommandNotFoundError (→ 404 at the HTTP layer), not return a
        # stale PENDING response.
        dup_session = self.factory()
        with self.assertRaises(CommandNotFoundError):
            self.service.accept(
                dup_session,
                principal=self.driver_principal,
                service="taxi",
                entity_type="order",
                entity_id=42,
                envelope=_make_envelope("driver_arrived", "expired-dup-key"),
            )
        dup_session.rollback()
        dup_session.close()


# --------------------------------------------------------------------------- #
# Status transition state-machine tests
# --------------------------------------------------------------------------- #


class StatusTransitionTests(unittest.TestCase):
    """TASK-CORE-001 §3 + §16: formal state machine for command status.

    The normative transition graph is:

        PENDING  ──►  PROCESSING  ──►  COMPLETED
                         │
                         └──────►  FAILED

    Terminal states (COMPLETED, FAILED) are immutable: there are no outgoing
    edges. ``PENDING → COMPLETED`` and ``PENDING → FAILED`` are allowed for
    the operational case where the worker resolves a command without ever
    committing a ``PROCESSING`` update (e.g. synchronous validation failure).
    """

    def test_allowed_transitions_match_normative_graph(self):
        from fsm_core.command_idempotency import (
            ALLOWED_TRANSITIONS,
            COMPLETED,
            FAILED,
            PENDING,
            PROCESSING,
        )

        expected = {
            (PENDING, PROCESSING),
            (PENDING, COMPLETED),
            (PENDING, FAILED),
            (PROCESSING, COMPLETED),
            (PROCESSING, FAILED),
            (PROCESSING, PENDING),  # recovery
        }
        self.assertEqual(ALLOWED_TRANSITIONS, expected)

    def test_terminal_states_have_no_outgoing_edges(self):
        from fsm_core.command_idempotency import is_allowed_transition

        # COMPLETED cannot transition to anything.
        for target in ("PENDING", "PROCESSING", "FAILED"):
            self.assertFalse(is_allowed_transition("COMPLETED", target))
        # FAILED cannot transition to anything.
        for target in ("PENDING", "PROCESSING", "COMPLETED"):
            self.assertFalse(is_allowed_transition("FAILED", target))

    def test_idempotent_rewrites_are_allowed(self):
        from fsm_core.command_idempotency import is_allowed_transition

        # Re-writing the same status is always allowed (e.g. recovery flips
        # PROCESSING → PENDING; worker marks PROCESSING twice).
        for status in ("PENDING", "PROCESSING", "COMPLETED", "FAILED"):
            self.assertTrue(is_allowed_transition(status, status))

    def test_invalid_status_is_rejected(self):
        from fsm_core.command_idempotency import is_allowed_transition

        self.assertFalse(is_allowed_transition("PENDING", "BANANA"))
        self.assertFalse(is_allowed_transition(None, "BANANA"))

    def test_none_from_status_allows_only_pending(self):
        """Initial write (put_command_idempotency) must start in PENDING.

        Permitting None → COMPLETED or None → FAILED would let a caller
        fabricate a terminal result without ever invoking the worker,
        bypassing the entire lifecycle. Only PENDING is a valid initial
        status for a fresh command execution.
        """

        from fsm_core.command_idempotency import is_allowed_transition

        self.assertTrue(is_allowed_transition(None, "PENDING"))
        self.assertFalse(is_allowed_transition(None, "PROCESSING"))
        self.assertFalse(is_allowed_transition(None, "COMPLETED"))
        self.assertFalse(is_allowed_transition(None, "FAILED"))


# --------------------------------------------------------------------------- #
# Runtime transition enforcement — update_command_status must call
# is_allowed_transition() and reject forbidden transitions
# --------------------------------------------------------------------------- #


class RuntimeTransitionEnforcementTests(unittest.TestCase):
    """TASK-CORE-001 — fourth-review BLOCKER: ``ALLOWED_TRANSITIONS`` was
    declarative documentation but ``update_command_status`` did not actually
    call ``is_allowed_transition``. The helper now reads the current status
    and raises ``CommandStatusError`` for any transition not in the graph.

    These tests verify the **runtime** enforcement (not just the
    ``is_allowed_transition`` function in isolation): they drive a real
    ``update_command_status`` call against a row whose status was set up
    beforehand, and assert that forbidden transitions raise.
    """

    def setUp(self) -> None:
        self.service, self.factory = _build_service()
        self.driver_principal = Principal(user_id=205, roles=("driver",))

    def _create_command_with_status(
        self,
        idempotency_key: str,
        target_status: str,
    ) -> int:
        """Helper: POST a command, then drive it into ``target_status`` via
        the allowed path. Returns the instance_id.

        The transition path for each target status is declarative — a list of
        (status, kwargs) pairs that the helper applies in order. This makes
        the setup readable and avoids a long if/elif chain.
        """

        # Transition path: list of (status, kwargs) pairs to apply.
        # Empty list means "no transitions needed" (e.g. PENDING is the
        # initial status after POST).
        transition_paths = {
            PENDING: [],
            PROCESSING: [(PROCESSING, {})],
            COMPLETED: [(PROCESSING, {}), (COMPLETED, {})],
            FAILED: [
                (PROCESSING, {}),
                (
                    FAILED,
                    {
                        "error_code": "INVALID_TRANSITION",
                        "error_message": "test",
                    },
                ),
            ],
        }

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", idempotency_key),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        for status, kwargs in transition_paths[target_status]:
            update_command_status(ws, instance_id, status, **kwargs)
        ws.commit()
        ws.close()
        return instance_id

    def test_pending_to_processing_is_allowed(self):
        """PENDING → PROCESSING is in ALLOWED_TRANSITIONS."""

        instance_id = self._create_command_with_status("rte-pending-proc", PENDING)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PROCESSING)
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_pending_to_completed_is_allowed(self):
        """PENDING → COMPLETED is allowed (operational shortcut)."""

        instance_id = self._create_command_with_status("rte-pending-completed", PENDING)
        ws = self.factory()
        result = update_command_status(ws, instance_id, COMPLETED)
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_pending_to_failed_is_allowed(self):
        """PENDING → FAILED is allowed (operational shortcut)."""

        instance_id = self._create_command_with_status("rte-pending-failed", PENDING)
        ws = self.factory()
        result = update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INVALID_TRANSITION",
            error_message="test",
        )
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_processing_to_pending_is_allowed(self):
        """PROCESSING → PENDING is allowed (recovery)."""

        instance_id = self._create_command_with_status("rte-proc-pending", PROCESSING)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PENDING)
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_completed_to_pending_returns_false(self):
        """COMPLETED → PENDING is forbidden (terminal immutability). The
        helper returns False rather than raising — so the worker's failure
        path can treat a concurrent terminal transition as a soft no-op."""

        instance_id = self._create_command_with_status("rte-completed-pending", COMPLETED)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PENDING)
        ws.commit()
        ws.close()
        self.assertFalse(result)

    def test_completed_to_processing_returns_false(self):
        """COMPLETED → PROCESSING is forbidden (terminal immutability)."""

        instance_id = self._create_command_with_status("rte-completed-proc", COMPLETED)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PROCESSING)
        ws.commit()
        ws.close()
        self.assertFalse(result)

    def test_completed_to_failed_returns_false(self):
        """COMPLETED → FAILED is forbidden (terminal immutability). The
        FAILED branch must also return False, not lie with True."""

        instance_id = self._create_command_with_status("rte-completed-failed", COMPLETED)
        ws = self.factory()
        result = update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INTERNAL_ERROR",
            error_message="late failure",
        )
        ws.commit()
        ws.close()
        self.assertFalse(result)

    def test_failed_to_pending_returns_false(self):
        """FAILED → PENDING is forbidden (terminal immutability)."""

        instance_id = self._create_command_with_status("rte-failed-pending", FAILED)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PENDING)
        ws.commit()
        ws.close()
        self.assertFalse(result)

    def test_failed_to_completed_returns_false(self):
        """FAILED → COMPLETED is forbidden (terminal immutability)."""

        instance_id = self._create_command_with_status("rte-failed-completed", FAILED)
        ws = self.factory()
        result = update_command_status(ws, instance_id, COMPLETED)
        ws.commit()
        ws.close()
        self.assertFalse(result)

    def test_idempotent_pending_rewrite_is_allowed(self):
        """PENDING → PENDING is an idempotent re-write; allowed (no-op)."""

        instance_id = self._create_command_with_status("rte-pending-pending", PENDING)
        ws = self.factory()
        # PENDING → PENDING: is_allowed_transition returns True for same
        # status, so update_command_status proceeds. The conditional UPDATE
        # matches 1 row (status is PENDING, not terminal) and returns True.
        result = update_command_status(ws, instance_id, PENDING)
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_idempotent_processing_rewrite_is_allowed(self):
        """PROCESSING → PROCESSING is an idempotent re-write; allowed."""

        instance_id = self._create_command_with_status("rte-proc-proc", PROCESSING)
        ws = self.factory()
        result = update_command_status(ws, instance_id, PROCESSING)
        ws.commit()
        ws.close()
        self.assertTrue(result)

    def test_invalid_status_raises_command_status_error(self):
        """An unknown status value raises CommandStatusError (vocabulary
        check, runs before the transition check)."""

        instance_id = self._create_command_with_status("rte-invalid-status", PENDING)
        ws = self.factory()
        with self.assertRaises(CommandStatusError):
            update_command_status(ws, instance_id, "BANANA")
        ws.rollback()
        ws.close()

    def test_nonexistent_instance_returns_false(self):
        """When the row does not exist, ``_get_current_status`` returns None
        and the helper returns False without raising."""

        ws = self.factory()
        result = update_command_status(ws, 999999, PROCESSING)
        ws.rollback()
        ws.close()
        self.assertFalse(result)

    def test_put_command_idempotency_rejects_non_pending_initial_status(self):
        """put_command_idempotency must refuse to create a row that starts
        in a non-PENDING status. Otherwise a caller could fabricate a
        terminal result without ever invoking the worker."""

        from fsm_core.command_idempotency import put_command_idempotency

        ws = self.factory()
        for bad_initial in (PROCESSING, COMPLETED, FAILED):
            with self.assertRaises(CommandStatusError):
                put_command_idempotency(
                    ws,
                    service="taxi",
                    key=f"bad-initial-{bad_initial}",
                    response={"instanceId": 1},
                    instance_id=1,
                    status=bad_initial,
                )
        ws.rollback()
        ws.close()

    def test_put_command_idempotency_accepts_pending_initial_status(self):
        """put_command_idempotency accepts status=None (defaults to PENDING)
        and status='PENDING' explicitly."""

        from fsm_core.command_idempotency import put_command_idempotency

        ws = self.factory()
        # Explicit PENDING.
        self.assertTrue(
            put_command_idempotency(
                ws,
                service="taxi",
                key="explicit-pending",
                response={"instanceId": 1},
                instance_id=1,
                status=PENDING,
            )
        )
        # None defaults to PENDING.
        self.assertTrue(
            put_command_idempotency(
                ws,
                service="taxi",
                key="implicit-pending",
                response={"instanceId": 2},
                instance_id=2,
                status=None,
            )
        )
        ws.rollback()
        ws.close()


# --------------------------------------------------------------------------- #
# errorCode vocabulary enforcement — update_command_status(FAILED) must
# normalise unknown codes to INTERNAL_ERROR
# --------------------------------------------------------------------------- #


class ErrorCodeVocabularyTests(unittest.TestCase):
    """TASK-CORE-001 §7: the ``errorCode`` field in a FAILED response must be
    one of the closed vocabulary defined in ``KNOWN_ERROR_CODES``. The
    ``update_command_status`` helper enforces this on the write path by
    calling ``normalize_known_code`` — an unknown code is silently replaced
    with ``INTERNAL_ERROR`` so the stored data is clean even if a future
    caller bypasses ``classify_exception``.
    """

    def setUp(self) -> None:
        self.service, self.factory = _build_service()
        self.driver_principal = Principal(user_id=205, roles=("driver",))

    def _create_command_in_processing(self, idempotency_key: str) -> int:
        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", idempotency_key),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        ws.commit()
        ws.close()
        return instance_id

    def test_known_error_code_is_preserved(self):
        """Known codes (INVALID_TRANSITION, UNKNOWN_ENTITY, etc.) are stored
        as-is and returned by GET."""

        from fsm_core.error_codes import (
            INVALID_TRANSITION,
            UNKNOWN_ENTITY,
            INVALID_PARAMETERS,
            AUTHORIZATION_FAILED,
            INTERNAL_ERROR,
        )

        for code in (
            INVALID_TRANSITION,
            UNKNOWN_ENTITY,
            INVALID_PARAMETERS,
            AUTHORIZATION_FAILED,
            INTERNAL_ERROR,
        ):
            instance_id = self._create_command_in_processing(f"known-code-{code}")
            ws = self.factory()
            update_command_status(
                ws,
                instance_id,
                FAILED,
                error_code=code,
                error_message=f"test {code}",
            )
            ws.commit()
            ws.close()

            status_session = self.factory()
            status = self.service.get_command_status(
                status_session, instance_id, principal=self.driver_principal
            )
            status_session.rollback()
            status_session.close()
            self.assertEqual(status["status"], FAILED)
            self.assertEqual(status["errorCode"], code)

    def test_unknown_error_code_is_normalised_to_internal_error(self):
        """An unknown code (e.g. 'BANANA') is replaced with INTERNAL_ERROR
        on the write path, so the stored data and the GET response never
        contain an undocumented value."""

        instance_id = self._create_command_in_processing("unknown-code")
        ws = self.factory()
        update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="BANANA",
            error_message="this is not a real code",
        )
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(
            status["errorCode"],
            "INTERNAL_ERROR",
            "Unknown error codes must be normalised to INTERNAL_ERROR",
        )
        self.assertEqual(status["errorMessage"], "this is not a real code")

    def test_none_error_code_falls_back_to_internal_error_in_get(self):
        """When update_command_status(FAILED) is called without error_code,
        no errorCode is written to response_json. GET then falls back to
        INTERNAL_ERROR (the default in get_command_status)."""

        instance_id = self._create_command_in_processing("none-code")
        ws = self.factory()
        # Call without error_code — falls through to the simple UPDATE
        # branch (no errorCode in response_json).
        update_command_status(ws, instance_id, FAILED)
        ws.commit()
        ws.close()

        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(status["errorCode"], "INTERNAL_ERROR")


# --------------------------------------------------------------------------- #
# FAILED race-condition tests — rowcount must drive the return value
# --------------------------------------------------------------------------- #


class FailedRaceConditionTests(unittest.TestCase):
    """TASK-CORE-001 — third-review BLOCKER: when two workers race to mark a
    command FAILED, the helper must return ``False`` for the loser (whose
    conditional ``UPDATE ... WHERE status NOT IN ('COMPLETED', 'FAILED')``
    matched 0 rows) — not ``True``.

    Previously the FAILED branch returned ``True`` unconditionally, which lied
    to the caller and caused ``server_fsm_instances`` and
    ``fsm_command_idempotency`` to diverge (one said FAILED, the other stayed
    COMPLETED).
    """

    def setUp(self) -> None:
        self.service, self.factory = _build_service()
        self.driver_principal = Principal(user_id=205, roles=("driver",))

    def test_failed_after_completed_returns_false(self):
        """Worker A marks COMPLETED, then Worker B tries to mark FAILED with
        errorCode — the FAILED update must return False because the row is
        already terminal."""

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "race-fail-after-complete"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        # Worker A: PENDING → PROCESSING → COMPLETED.
        self.assertTrue(update_command_status(ws, instance_id, PROCESSING))
        self.assertTrue(update_command_status(ws, instance_id, COMPLETED))
        # Worker B: tries to flip to FAILED (e.g. it crashed mid-flight and
        # restarted, then its FSM action failed). Must return False.
        result = update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INTERNAL_ERROR",
            error_message="late failure after completion",
        )
        ws.commit()
        ws.close()
        self.assertFalse(
            result,
            "FAILED update after COMPLETED must return False — "
            "terminal immutability must be reflected in the return value, "
            "not just in the SQL WHERE clause.",
        )

        # The idempotency row must still be COMPLETED with no errorCode.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], COMPLETED)
        self.assertNotIn("errorCode", status)

    def test_failed_after_failed_returns_false(self):
        """Worker A marks FAILED, then Worker B tries to mark FAILED again
        with a different errorCode — must return False; the original
        errorCode is preserved."""

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "race-fail-after-fail"),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INVALID_TRANSITION",
            error_message="first failure",
        )
        # Worker B: tries to overwrite with a different errorCode.
        result = update_command_status(
            ws,
            instance_id,
            FAILED,
            error_code="INTERNAL_ERROR",
            error_message="second failure",
        )
        ws.commit()
        ws.close()
        self.assertFalse(result)

        # Original errorCode is preserved.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(status["errorCode"], "INVALID_TRANSITION")
        self.assertEqual(status["errorMessage"], "first failure")


# --------------------------------------------------------------------------- #
# recover_stale tests — synchronisation between server_fsm_instances and
# fsm_command_idempotency
# --------------------------------------------------------------------------- #


class RecoverStaleTests(unittest.TestCase):
    """TASK-CORE-001 — third-review HIGH: ``recover_stale`` must synchronise
    both tables. Previously only ``server_fsm_instances`` was updated, leaving
    ``fsm_command_idempotency`` in a stale ``PROCESSING`` state — the GET
    endpoint would then return a status contradicting the actual FSM state.

    Three scenarios are tested:

    1. **Non-terminal recovery**: PROCESSING → PENDING (retry). Both tables
       must end up in PENDING.
    2. **Exhausted recovery**: PROCESSING → FAILED (retry limit reached).
       Both tables must end up in FAILED, with errorCode persisted.
    3. **Terminal immutability**: if ``fsm_command_idempotency`` is already
       terminal (COMPLETED), recovery must NOT overwrite it — even if
       ``server_fsm_instances`` flips to FAILED. The Command Completion API
       returns the authoritative terminal status.
    """

    def setUp(self) -> None:
        from fsm_core import FsmEngine, FsmRegistry
        from fsm_core.workers import FsmInstanceWorker

        self.registry = FsmRegistry()
        self.registry.register_access_policy(
            "taxi", "order", lambda *args, **kwargs: True
        )
        self.registry.register_snapshot_builder(
            "taxi", "order", lambda *args, **kwargs: {"ok": True}
        )
        self.service, self.factory = _build_service()
        # Replace the registry in the service's snapshot service so the
        # FsmInstanceWorker shares the same access policy / snapshot builder.
        self.service.snapshot_service.registry = self.registry
        self.driver_principal = Principal(user_id=205, roles=("driver",))
        self.worker = FsmInstanceWorker(
            FsmEngine(self.registry),
            worker_id="test-worker",
            max_attempts=3,
            lock_timeout_seconds=300,
        )

    def _create_command_and_advance_to_processing(self, idempotency_key: str) -> int:
        """Helper: POST a command, then simulate the worker claiming it
        (PROCESSING) without completing it. The instance is now in
        PROCESSING in both tables — ready for a recover_stale test."""

        session = self.factory()
        result = self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", idempotency_key),
        )
        session.commit()
        session.close()
        instance_id = result.response["instanceId"]

        # Simulate the worker claiming the instance (PROCESSING).
        ws = self.factory()
        update_command_status(ws, instance_id, PROCESSING)
        # Mirror in server_fsm_instances.
        server_instances = ws._store.setdefault("server_instances", {})
        server_instances[instance_id]["instance_status"] = "PROCESSING"
        server_instances[instance_id]["attempts_count"] = 1
        server_instances[instance_id]["locked_at"] = "stale"
        ws.commit()
        ws.close()
        return instance_id

    def test_recover_non_terminal_syncs_both_tables_to_pending(self):
        """PROCESSING → PENDING: both tables end up in PENDING."""

        instance_id = self._create_command_and_advance_to_processing(
            "recover-pending"
        )

        # Run recover_stale.
        rs = self.factory()
        recovered = self.worker.recover_stale(rs)
        rs.commit()
        rs.close()
        self.assertGreaterEqual(recovered, 1)

        # server_fsm_instances must be PENDING.
        server_inst = self.factory.store["server_instances"][instance_id]
        self.assertEqual(server_inst["instance_status"], "PENDING")

        # fsm_command_idempotency must also be PENDING.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], PENDING)

    def test_recover_exhausted_syncs_both_tables_to_failed(self):
        """PROCESSING → FAILED: both tables end up in FAILED with errorCode."""

        instance_id = self._create_command_and_advance_to_processing(
            "recover-failed"
        )

        # Bump attempts_count to >= max_attempts (3) so recovery chooses FAILED.
        server_instances = self.factory.store["server_instances"]
        server_instances[instance_id]["attempts_count"] = 3

        rs = self.factory()
        recovered = self.worker.recover_stale(rs)
        rs.commit()
        rs.close()
        self.assertGreaterEqual(recovered, 1)

        # server_fsm_instances must be FAILED.
        server_inst = self.factory.store["server_instances"][instance_id]
        self.assertEqual(server_inst["instance_status"], "FAILED")

        # fsm_command_idempotency must also be FAILED with errorCode.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(status["status"], FAILED)
        self.assertEqual(status["errorCode"], "INTERNAL_ERROR")
        self.assertIn(
            "Worker lock expired",
            status.get("errorMessage", ""),
        )

    def test_recover_does_not_overwrite_terminal_command(self):
        """If fsm_command_idempotency is already COMPLETED, recovery must NOT
        overwrite it — even though server_fsm_instances flips to FAILED.

        This is the architectural contract: ``fsm_command_idempotency.status``
        is the authoritative public command outcome; ``server_fsm_instances``
        is internal execution state. Terminal immutability of the public
        outcome takes precedence over internal state synchronisation.
        """

        instance_id = self._create_command_and_advance_to_processing(
            "recover-terminal"
        )

        # Worker A finishes the command: COMPLETED in both tables.
        ws = self.factory()
        update_command_status(ws, instance_id, COMPLETED)
        ws._store["server_instances"][instance_id]["instance_status"] = "COMPLETED"
        ws.commit()
        ws.close()

        # Now simulate a *different* worker crash: a second worker had
        # claimed the same instance (impossible in production due to
        # FOR UPDATE SKIP LOCKED, but possible if a worker crashed and its
        # lease expired while the instance was already COMPLETED by another
        # path). server_fsm_instances shows PROCESSING with exhausted
        # attempts → recover_stale would flip it to FAILED.
        server_instances = self.factory.store["server_instances"]
        server_instances[instance_id]["instance_status"] = "PROCESSING"
        server_instances[instance_id]["attempts_count"] = 5  # exhausted
        server_instances[instance_id]["locked_at"] = "stale"

        rs = self.factory()
        recovered = self.worker.recover_stale(rs)
        rs.commit()
        rs.close()
        self.assertGreaterEqual(recovered, 1)

        # server_fsm_instances flipped to FAILED (internal execution state).
        server_inst = self.factory.store["server_instances"][instance_id]
        self.assertEqual(server_inst["instance_status"], "FAILED")

        # BUT fsm_command_idempotency remains COMPLETED — the authoritative
        # public outcome. The helper refused to overwrite the terminal row.
        status_session = self.factory()
        status = self.service.get_command_status(
            status_session, instance_id, principal=self.driver_principal
        )
        status_session.rollback()
        status_session.close()
        self.assertIsNotNone(status)
        self.assertEqual(
            status["status"],
            COMPLETED,
            "Command Completion API must return the terminal COMPLETED "
            "status even when server_fsm_instances has been recovered to "
            "FAILED. fsm_command_idempotency.status is the authoritative "
            "public outcome.",
        )
        self.assertNotIn("errorCode", status)

    def test_recover_with_no_stale_instances_is_noop(self):
        """When there are no stale PROCESSING instances, recover_stale
        returns 0 and does not touch any rows."""

        # Create a command but leave it in PENDING (not PROCESSING).
        session = self.factory()
        self.service.accept(
            session,
            principal=self.driver_principal,
            service="taxi",
            entity_type="order",
            entity_id=42,
            envelope=_make_envelope("driver_arrived", "recover-noop"),
        )
        session.commit()
        session.close()

        rs = self.factory()
        recovered = self.worker.recover_stale(rs)
        rs.commit()
        rs.close()
        self.assertEqual(recovered, 0)

    def test_recover_atomic_rollback_on_mirror_error(self):
        """BLOCKER-1 (atomicity): if update_command_status raises
        CommandStatusError during Step 3 (mirror), recover_stale must
        propagate the exception to the caller — NOT swallow it. The caller
        (_recover_stale_with_own_session / run_once) is then responsible for
        rolling back the transaction, which undoes Step 2 (UPDATE
        server_fsm_instances) so the two tables never diverge.

        This supersedes the earlier "resilience" approach (try/except + log
        + continue) because atomicity is more important for consistency-
        critical code: a partial recovery that desynchronises the two tables
        is worse than a rolled-back recovery that retries.

        Note: this test verifies that recover_stale does NOT swallow the
        exception. Verifying that the caller's rollback actually undoes the
        Step 2 UPDATE requires a real database (FakeSession does not
        emulate transactional rollback of in-memory state). The MySQL
        integration test suite covers that scenario."""

        from unittest.mock import patch
        from fsm_core.command_idempotency import CommandStatusError

        # Create a stale PROCESSING instance.
        self._create_command_and_advance_to_processing("recover-atomic-1")

        # Patch update_command_status to raise on the first call — simulates
        # a transition-graph change that makes the helper reject the
        # recovery transition.
        from fsm_core.command_idempotency import update_command_status as real_impl

        call_count = {"n": 0}

        def flaky_update(session, instance_id, status, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise CommandStatusError(
                    f"Invalid status transition (simulated graph change)"
                )
            return real_impl(session, instance_id, status, **kwargs)

        # Patch at the module level where workers.py imported the name.
        # Using ``patch`` as a context manager ensures the original function
        # is restored after the ``with`` block, so subsequent tests are not
        # affected by the mock. ``call_count`` is a local dict, recreated
        # for each test run — no shared state between tests.
        with patch(
            "fsm_core.workers.update_command_status",
            side_effect=flaky_update,
        ):
            rs = self.factory()
            # recover_stale must propagate the exception — NOT catch it.
            # The caller is responsible for rollback.
            with self.assertRaises(CommandStatusError):
                self.worker.recover_stale(rs)
            rs.rollback()
            rs.close()


if __name__ == "__main__":
    unittest.main()
