"""Worker building blocks for the FSM runtime.

Workers are the transaction boundary. The active Stage 3 instance worker opens
one SQLAlchemy session and transaction per instance, then commits or rolls back
that unit of work. The timer worker below remains a disconnected scaffold.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

from sqlalchemy import text
from sqlalchemy.orm import Session

from .command_completion import COMPLETES_COMMAND_KEY, FAILS_COMMAND_KEY, execution_scope
from .engine import FsmEngine
from .error_codes import classify_exception
from .serialization import json_dumps, json_loads_object
from .types import FsmResult, Trigger
from .command_idempotency import (
    COMPLETED,
    FAILED,
    PENDING,
    PROCESSING,
    update_command_status,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkerItemResult:
    item_id: int
    ok: bool
    message: Optional[str] = None
    fsm_result: Optional[FsmResult] = None


@dataclass(frozen=True)
class WorkerBatchResult:
    processed: int
    succeeded: int
    failed: int
    items: List[WorkerItemResult] = field(default_factory=list)


class SessionFactory(Protocol):
    def __call__(self) -> Session:
        ...


class FsmInstanceWorker:
    """Claim and execute FSM instances with one transaction per instance."""

    def __init__(
        self,
        engine: FsmEngine,
        *,
        worker_id: str = "fsm-worker",
        max_attempts: int = 3,
        lock_timeout_seconds: int = 300,
    ):
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if lock_timeout_seconds < 1:
            raise ValueError("lock_timeout_seconds must be at least 1")
        self.engine = engine
        self.worker_id = worker_id
        self.max_attempts = max_attempts
        self.lock_timeout_seconds = lock_timeout_seconds

    def run_once(
        self,
        session_factory: SessionFactory,
        *,
        limit: int = 20,
        system_user_id: int = 0,
    ) -> WorkerBatchResult:
        self._recover_stale_with_own_session(session_factory)

        items: List[WorkerItemResult] = []
        for _ in range(limit):
            session = session_factory()
            try:
                item = self.process_next(session, system_user_id=system_user_id)
                session.commit()
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()

            if item is None:
                break
            items.append(item)

        succeeded = sum(1 for item in items if item.ok)
        return WorkerBatchResult(
            processed=len(items),
            succeeded=succeeded,
            failed=len(items) - succeeded,
            items=items,
        )

    def process_pending(
        self,
        session: Session,
        *,
        limit: int = 20,
        system_user_id: int = 0,
    ) -> WorkerBatchResult:
        items: List[WorkerItemResult] = []
        for _ in range(limit):
            item = self.process_next(session, system_user_id=system_user_id)
            if item is None:
                break
            items.append(item)

        succeeded = sum(1 for item in items if item.ok)
        return WorkerBatchResult(
            processed=len(items),
            succeeded=succeeded,
            failed=len(items) - succeeded,
            items=items,
        )

    def process_next(
        self,
        session: Session,
        *,
        system_user_id: int = 0,
    ) -> Optional[WorkerItemResult]:
        row = session.execute(
            text(
                """
                SELECT id, service, process_name, entity_type, entity_id,
                       trigger_type, trigger_name, trigger_payload,
                       requested_by_user_id, metadata_json, requested_user_role
                FROM server_fsm_instances
                WHERE instance_status = 'PENDING'
                  AND service IS NOT NULL
                ORDER BY id
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                """
            )
        ).fetchone()
        if row is None:
            return None

        item_id = int(row[0])
        user_id = int(row[8] or system_user_id)
        instance_metadata = json_loads_object(row[9]) if len(row) > 9 else {}
        session.execute(
            text(
                """
                UPDATE server_fsm_instances
                SET instance_status = 'PROCESSING',
                    attempts_count = attempts_count + 1,
                    processing_started_at = CURRENT_TIMESTAMP,
                    processing_finished_at = NULL,
                    locked_at = CURRENT_TIMESTAMP,
                    locked_by = :worker_id,
                    result_json = NULL,
                    last_error = NULL
                WHERE id = :id
                """
            ),
            {"id": item_id, "worker_id": self.worker_id},
        )

        # Update command status to PROCESSING (terminal-state safe).
        update_command_status(session, item_id, PROCESSING)

        item_tx = session.begin_nested()
        try:
            payload = json_loads_object(row[7])
            trigger = Trigger(
                trigger_type=str(row[5] or "event"),
                trigger_name=str(row[6] or ""),
                payload=payload,
            )
            extra_id = payload.get("extra_id") or payload.get("pin")
            from .security import Principal
            principal = Principal(user_id, (str(row[10]),)) if len(row) > 10 else None
            with execution_scope(item_id, principal) as execution:
                fsm_result = self.engine.run_action(
                    session,
                    service=str(row[1]),
                    process_name=str(row[2]),
                    entity_type=str(row[3]),
                    entity_id=int(row[4]),
                    trigger=trigger,
                    user_id=user_id,
                    extra_id=str(extra_id) if extra_id is not None else None,
                )
            session.execute(
                text(
                    """
                    UPDATE server_fsm_instances
                    SET instance_status = 'COMPLETED',
                        fsm_state = :fsm_state,
                        processing_finished_at = CURRENT_TIMESTAMP,
                        locked_at = NULL,
                        locked_by = NULL,
                        result_json = :result_json,
                        last_error = NULL
                    WHERE id = :id
                    """
                ),
                {
                    "id": item_id,
                    "fsm_state": fsm_result.to_state,
                    "result_json": json_dumps(
                        {
                            "ok": fsm_result.ok,
                            "action_name": fsm_result.action_name,
                            "from_state": fsm_result.from_state,
                            "to_state": fsm_result.to_state,
                            "message": fsm_result.message,
                            "result_code": fsm_result.result_code,
                        }
                    ),
                },
            )

            # Update command status to COMPLETED (terminal-state safe). A
            # deferred command stays PROCESSING until its outbox follow-up
            # settles it; the instance row above is still COMPLETED because
            # the worker's own execution is finished.
            if not execution.deferred:
                update_command_status(session, item_id, COMPLETED)
            if getattr(getattr(self.engine, "registry", None), "external_sync_enabled", False):
                session.execute(text("DELETE FROM fsm_command_credentials WHERE instance_id=:id"), {"id": item_id})
            self._settle_linked_command(session, instance_metadata, succeeded=True)

            item_tx.commit()
            return WorkerItemResult(item_id=item_id, ok=True, fsm_result=fsm_result)
        except Exception as exc:
            item_tx.rollback()
            session.execute(
                text(
                    """
                    UPDATE server_fsm_instances
                    SET instance_status = 'FAILED',
                        processing_finished_at = CURRENT_TIMESTAMP,
                        locked_at = NULL,
                        locked_by = NULL,
                        last_error = :error
                    WHERE id = :id
                    """
                ),
                {"id": item_id, "error": str(exc)},
            )

            # Map the exception to a machine errorCode and persist both
            # status and errorCode atomically through the helper so the GET
            # endpoint can return ``{"status": "FAILED", "errorCode": "..."}``.
            classified = classify_exception(exc)
            if getattr(getattr(self.engine, "registry", None), "external_sync_enabled", False):
                session.execute(text("DELETE FROM fsm_command_credentials WHERE instance_id=:id"), {"id": item_id})
            update_command_status(
                session,
                item_id,
                FAILED,
                error_code=classified.code,
                error_message=classified.message,
            )
            self._settle_linked_command(
                session,
                instance_metadata,
                succeeded=False,
                failure_message=classified.message,
            )

            return WorkerItemResult(item_id=item_id, ok=False, message=str(exc))

    @staticmethod
    def _settle_linked_command(
        session: Session,
        metadata: Dict[str, Any],
        *,
        succeeded: bool,
        failure_message: Optional[str] = None,
    ) -> None:
        """Settle a deferred command from its outbox follow-up instance.

        ``completesCommand``: the external side effect was delivered, so the
        command is COMPLETED once the confirming transition commits.
        ``failsCommand``: delivery failed for good, so the command is FAILED
        with the delivery error once the compensating transition commits.
        If the follow-up transition itself fails, the command is FAILED with a
        message that names both steps.
        """

        completes = metadata.get(COMPLETES_COMMAND_KEY)
        if isinstance(completes, dict) and completes.get("instanceId") is not None:
            target = int(completes["instanceId"])
            if succeeded:
                update_command_status(session, target, COMPLETED)
            else:
                update_command_status(
                    session,
                    target,
                    FAILED,
                    error_code="INTERNAL_ERROR",
                    error_message=(
                        "External operation was delivered, but the confirming "
                        f"transition failed: {failure_message}"
                    ),
                )

        fails = metadata.get(FAILS_COMMAND_KEY)
        if isinstance(fails, dict) and fails.get("instanceId") is not None:
            target = int(fails["instanceId"])
            message = str(fails.get("errorMessage") or "External operation failed")
            if not succeeded:
                message = f"{message}; compensating transition failed: {failure_message}"
            update_command_status(
                session,
                target,
                FAILED,
                error_code=str(fails.get("errorCode") or "INTERNAL_ERROR"),
                error_message=message,
            )

    def recover_stale(self, session: Session) -> int:
        """Release abandoned PROCESSING rows after a worker crash.

        Also mirrors the same transition onto ``fsm_command_idempotency`` so
        the Command Completion API reflects the recovered state, **except**
        when the command is already in a terminal state.

        **Atomicity contract:** Step 2 (UPDATE ``server_fsm_instances``) and
        Step 3 (mirror to ``fsm_command_idempotency``) run in the caller's
        transaction. If any Step 3 mirror call raises, the whole recovery
        transaction is rolled back by the caller — both tables stay unchanged
        and the stale instances remain in PROCESSING for the next recovery
        cycle. This supersedes an earlier "resilience" approach (try/except +
        log + continue) because atomicity is more important for
        consistency-critical code: a partial recovery that desynchronises the
        two tables is worse than a rolled-back recovery that retries.

        Recovery guarantees:

        * For non-terminal commands (``PENDING`` / ``PROCESSING``): the
          ``fsm_command_idempotency`` status is updated to match the
          recovered ``server_fsm_instances`` status (``PENDING`` for retry,
          ``FAILED`` when retry limit is exhausted). The two tables never
          disagree on non-terminal commands after recovery.

        * For terminal commands (``COMPLETED`` / ``FAILED``): the helper
          ``update_command_status`` refuses to overwrite the row. This is
          intentional — terminal immutability is part of the TASK-CORE-001
          contract. In that case ``server_fsm_instances`` may flip from
          ``PROCESSING`` to ``FAILED`` (because the worker crashed mid-flight
          and exhausted its retry budget) while ``fsm_command_idempotency``
          remains ``COMPLETED``. The Command Completion API still returns the
          terminal ``COMPLETED`` status, which is the authoritative answer
          for the client.

        Without this second step the two tables could drift apart for
        non-terminal commands after a worker crash (e.g.
        ``server_fsm_instances`` flipped to ``PENDING`` while the idempotency
        row was still ``PROCESSING``), which violates TASK-CORE-001 §4
        (instanceId ↔ execution correlation).
        """

        # Step 1: collect the instance ids that are about to be recovered, so
        # we can apply the same transition to fsm_command_idempotency in the
        # same transaction.
        #
        # ``FOR UPDATE SKIP LOCKED`` prevents two concurrent recovery workers
        # from picking up the same stale rows: the first one locks them, the
        # second one skips to the next available batch. Without this clause
        # two workers could both SELECT the same rows, both attempt the
        # UPDATE (one would match 0 rows due to the changed status), and
        # both call ``update_command_status`` — harmless but wasteful.
        #
        # Race safety: the SELECT locks the matched rows until the
        # transaction commits, so another transaction cannot modify them
        # between Step 1 and Step 2. If the transaction is rolled back, the
        # locks are released and the rows become available for the next
        # recovery cycle.
        stale_rows = session.execute(
            text(
                """
                SELECT id,
                       CASE
                           WHEN attempts_count >= :max_attempts THEN 'FAILED'
                           ELSE 'PENDING'
                       END AS next_status
                FROM server_fsm_instances
                WHERE instance_status = 'PROCESSING'
                  AND (
                      locked_at IS NULL
                      OR locked_at < TIMESTAMPADD(
                          SECOND,
                          -:lock_timeout_seconds,
                          CURRENT_TIMESTAMP
                      )
                  )
                FOR UPDATE SKIP LOCKED
                """
            ),
            {
                "max_attempts": self.max_attempts,
                "lock_timeout_seconds": self.lock_timeout_seconds,
            },
        ).fetchall()

        if not stale_rows:
            return 0

        instance_to_status = {int(row[0]): str(row[1]) for row in stale_rows}

        # Step 2: flip server_fsm_instances — but ONLY for the instance_ids
        # captured in Step 1. A broad ``WHERE instance_status='PROCESSING'``
        # UPDATE would also match a *new* stale execution that appeared
        # between Step 1 and Step 2 (e.g. another worker crashed and its
        # lease expired), and Step 3 would not mirror it to
        # fsm_command_idempotency because it is not in
        # ``instance_to_status`` — causing the two tables to diverge.
        # Constraining the UPDATE to ``WHERE id IN (:ids)`` closes this
        # race window.
        instance_ids = list(instance_to_status.keys())
        # Build a parameterised IN-list. MySQL/SQLAlchemy does not natively
        # expand a Python list into ``IN (:ids)`` for text() statements, so
        # we generate unique bind-parameter names (id_0, id_1, ...).
        in_params = {f"id_{i}": iid for i, iid in enumerate(instance_ids)}
        in_clause = ", ".join(f":{name}" for name in in_params)

        result = session.execute(
            text(
                f"""
                UPDATE server_fsm_instances
                SET instance_status = CASE
                        WHEN attempts_count >= :max_attempts THEN 'FAILED'
                        ELSE 'PENDING'
                    END,
                    processing_finished_at = CASE
                        WHEN attempts_count >= :max_attempts THEN CURRENT_TIMESTAMP
                        ELSE processing_finished_at
                    END,
                    locked_at = NULL,
                    locked_by = NULL,
                    last_error = CASE
                        WHEN attempts_count >= :max_attempts
                        THEN 'Worker lock expired and retry limit was reached'
                        ELSE last_error
                    END
                WHERE id IN ({in_clause})
                """
            ),
            {
                "max_attempts": self.max_attempts,
                **in_params,
            },
        )
        recovered_count = int(result.rowcount or 0)

        # Step 3: mirror the same transition on fsm_command_idempotency.
        # update_command_status() is terminal-state safe: rows that are
        # already COMPLETED/FAILED are left untouched.
        #
        # Atomicity contract: if any mirror call raises (e.g.
        # ``CommandStatusError`` because the transition graph was changed),
        # the whole recovery transaction MUST be rolled back — otherwise
        # ``server_fsm_instances`` would already be updated (Step 2) while
        # ``fsm_command_idempotency`` stays stale, causing a permanent
        # divergence between the two tables. The caller (``run_once`` /
        # ``_recover_stale_with_own_session``) catches the exception, rolls
        # back the session, and the stale instances remain in PROCESSING
        # for the next recovery cycle.
        #
        # This supersedes the earlier "resilience" approach (try/except +
        # log + continue) because atomicity is more important for
        # consistency-critical code: a partial recovery that desynchronises
        # the two tables is worse than a rolled-back recovery that retries
        # on the next cycle. The conditional UPDATE in the helper remains
        # the authoritative guard for terminal-state immutability; the
        # atomic rollback here protects against transition-graph changes
        # and other unexpected helper errors.
        for instance_id, next_status in instance_to_status.items():
            if next_status == FAILED:
                update_command_status(
                    session,
                    instance_id,
                    FAILED,
                    error_code="INTERNAL_ERROR",
                    error_message="Worker lock expired and retry limit was reached",
                )
            else:
                update_command_status(session, instance_id, PENDING)

        return recovered_count

    def _recover_stale_with_own_session(self, session_factory: SessionFactory) -> None:
        session = session_factory()
        try:
            self.recover_stale(session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


class FsmTimerWorker:
    """Experimental timer scaffold; not connected to the Stage 3 runtime."""

    def __init__(self, engine: FsmEngine, *, worker_id: str = "fsm-timer-worker"):
        self.engine = engine
        self.worker_id = worker_id

    def run_once(
        self,
        session_factory: SessionFactory,
        *,
        limit: int = 20,
        system_user_id: int = 0,
    ) -> WorkerBatchResult:
        session = session_factory()
        try:
            result = self.process_due(session, limit=limit, system_user_id=system_user_id)
            session.commit()
            return result
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def process_due(
        self,
        session: Session,
        *,
        limit: int = 20,
        system_user_id: int = 0,
    ) -> WorkerBatchResult:
        rows = session.execute(
            text(
                """
                SELECT id, service, process_name, entity_type, entity_id,
                       timer_name, timer_params, action_name
                FROM fsm_timers
                WHERE status = 'PENDING'
                  AND due_at <= CURRENT_TIMESTAMP
                ORDER BY due_at, id
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"limit": limit},
        ).fetchall()

        items: List[WorkerItemResult] = []
        for row in rows:
            timer_id = int(row[0])
            item_tx = session.begin_nested()
            try:
                session.execute(
                    text(
                        """
                        UPDATE fsm_timers
                        SET status = 'PROCESSING',
                            locked_at = CURRENT_TIMESTAMP,
                            locked_by = :worker_id
                        WHERE id = :id
                        """
                    ),
                    {"id": timer_id, "worker_id": self.worker_id},
                )
                params = json_loads_object(row[6])
                trigger = Trigger(
                    trigger_type="timer",
                    trigger_name=str(row[5]),
                    payload={
                        "timer_id": timer_id,
                        "action_name": str(row[7]),
                        "timer_params": params,
                    },
                )
                fsm_result = self.engine.run_action(
                    session,
                    service=str(row[1]),
                    process_name=str(row[2]),
                    entity_type=str(row[3]),
                    entity_id=int(row[4]),
                    trigger=trigger,
                    user_id=system_user_id,
                )
                session.execute(
                    text(
                        """
                        UPDATE fsm_timers
                        SET status = 'FIRED',
                            fired_at = CURRENT_TIMESTAMP,
                            locked_at = NULL,
                            locked_by = NULL,
                            last_error = NULL
                        WHERE id = :id
                        """
                    ),
                    {"id": timer_id},
                )
                item_tx.commit()
                items.append(WorkerItemResult(item_id=timer_id, ok=True, fsm_result=fsm_result))
            except Exception as exc:
                item_tx.rollback()
                session.execute(
                    text(
                        """
                        UPDATE fsm_timers
                        SET status = 'FAILED',
                            attempts = attempts + 1,
                            locked_at = NULL,
                            locked_by = NULL,
                            last_error = :error
                        WHERE id = :id
                        """
                    ),
                    {"id": timer_id, "error": str(exc)},
                )
                items.append(WorkerItemResult(item_id=timer_id, ok=False, message=str(exc)))

        succeeded = sum(1 for item in items if item.ok)
        failed = len(items) - succeeded
        return WorkerBatchResult(processed=len(items), succeeded=succeeded, failed=failed, items=items)


def enqueue_instance_trigger(
    session: Session,
    *,
    service: str,
    process_name: str,
    entity_type: str,
    entity_id: int,
    trigger: Trigger,
    user_id: Optional[int] = None,
) -> bool:
    """Append a worker task without overwriting an already queued trigger.

    Each command receives its own ``server_fsm_instances`` row. Concurrent
    commands are therefore both durable; SQL Core resolves any stale-state
    conflict when workers execute them.
    """

    instance_id = enqueue_fsm_instance(
        session,
        service=service,
        process_name=process_name,
        entity_type=entity_type,
        entity_id=entity_id,
        trigger=trigger,
        user_id=user_id,
    )
    return instance_id > 0


def enqueue_fsm_instance(
    session: Session,
    *,
    service: str,
    process_name: str,
    entity_type: str,
    entity_id: int,
    trigger: Trigger,
    user_id: Optional[int] = None,
    user_role: Optional[str] = None,
    target_user_id: Optional[int] = None,
    target_role: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> int:
    """Create a ready FSM task without taking ownership of the transaction."""

    session.execute(
        text(
            """
            INSERT INTO server_fsm_instances (
                service, process_name, entity_type, entity_id,
                instance_status, trigger_type, trigger_name, trigger_payload,
                requested_by_user_id, requested_user_role,
                target_user_id, target_role, metadata_json
            )
            VALUES (
                :service, :process_name, :entity_type, :entity_id,
                'PENDING', :trigger_type, :trigger_name, :trigger_payload,
                :user_id, :user_role,
                :target_user_id, :target_role, :metadata_json
            )
            """
        ),
        {
            "service": service,
            "process_name": process_name,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "trigger_type": trigger.trigger_type,
            "trigger_name": trigger.trigger_name,
            "trigger_payload": json_dumps(trigger.payload),
            "user_id": user_id,
            "user_role": user_role,
            "target_user_id": target_user_id,
            "target_role": target_role,
            "metadata_json": json_dumps(metadata or {}),
        },
    )
    row = session.execute(text("SELECT LAST_INSERT_ID()")).fetchone()
    return int(row[0]) if row and row[0] else 0
