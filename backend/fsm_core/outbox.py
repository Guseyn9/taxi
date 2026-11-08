"""Transactional outbox delivery with no network calls inside DB transactions."""

from __future__ import annotations

import urllib.error
import urllib.request
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .command_completion import COMPLETES_COMMAND_KEY, FAILS_COMMAND_KEY
from .serialization import json_dumps, json_loads, json_loads_object
from .types import Trigger
from .workers import SessionFactory, WorkerBatchResult, WorkerItemResult, enqueue_fsm_instance


# Upper bound for a delivery error copied into follow-up trigger metadata.
_MAX_COMPLETION_ERROR_LENGTH = 1000


@dataclass(frozen=True)
class OutboxCompletion:
    """Follow-up triggers for an outbox event that settles a command.

    After final delivery the dispatcher enqueues ``on_sent_trigger`` (status
    ``SENT``) or ``on_failed_trigger`` (terminal ``FAILED``) for the event's
    aggregate in ``process_name``. When ``command_instance_id`` is set the
    follow-up instance carries a link that lets the worker settle that command.
    """

    process_name: str
    on_sent_trigger: str
    on_failed_trigger: str
    command_instance_id: Optional[int] = None
    invocation: Optional[Dict[str, Any]] = None

    def to_json(self) -> Dict[str, Any]:
        return {
            "processName": self.process_name,
            "onSentTrigger": self.on_sent_trigger,
            "onFailedTrigger": self.on_failed_trigger,
            "commandInstanceId": self.command_instance_id,
            "invocation": self.invocation,
        }

    @classmethod
    def from_json(cls, value: Any) -> Optional["OutboxCompletion"]:
        data = json_loads_object(value) if value is not None else {}
        if not data:
            return None
        instance_id = data.get("commandInstanceId")
        return cls(
            process_name=str(data["processName"]),
            on_sent_trigger=str(data["onSentTrigger"]),
            on_failed_trigger=str(data["onFailedTrigger"]),
            command_instance_id=int(instance_id) if instance_id is not None else None,
            invocation=data.get("invocation"),
        )


@dataclass(frozen=True)
class OutboxEvent:
    id: int
    service: str
    aggregate_type: str
    aggregate_id: int
    event_type: str
    payload: Dict[str, Any]
    handler_name: str
    attempts: int
    max_attempts: int
    idempotency_key: str
    completion: Optional[OutboxCompletion] = None
    credentials_encrypted: Optional[str] = field(default=None, repr=False)
    write_attempted: Optional[bool] = None
    before_write: Optional[Callable] = field(default=None, repr=False, compare=False)


class PermanentDeliveryError(Exception):
    pass


@dataclass(frozen=True)
class DeliveryResult:
    response: Dict[str, Any] = field(default_factory=dict)


OutboxHandler = Callable[[OutboxEvent], Optional[DeliveryResult]]


def enqueue_outbox_event(
    session: Session,
    *,
    service: str,
    aggregate_type: str,
    aggregate_id: int,
    event_type: str,
    payload: Dict[str, Any],
    idempotency_key: str,
    handler_name: str = "core_http",
    max_attempts: int = 8,
    completion: Optional[OutboxCompletion] = None,
) -> int:
    """Write an external effect in the caller-owned domain transaction."""

    if not idempotency_key:
        raise ValueError("idempotency_key is required")
    session.execute(
        text(
            """
            INSERT INTO core_outbox (
                service, aggregate_type, aggregate_id, event_type,
                payload, idempotency_key, handler_name, max_attempts,
                completion_json
            ) VALUES (
                :service, :aggregate_type, :aggregate_id, :event_type,
                :payload, :idempotency_key, :handler_name, :max_attempts,
                :completion_json
            )
            ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
            """
        ),
        {
            "service": service,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "event_type": event_type,
            "payload": json_dumps(payload),
            "idempotency_key": idempotency_key,
            "handler_name": handler_name,
            "max_attempts": max_attempts,
            "completion_json": json_dumps(completion.to_json()) if completion else None,
        },
    )
    row = session.execute(text("SELECT LAST_INSERT_ID()"), {}).fetchone()
    return int(row[0]) if row and row[0] else 0


class OutboxHandlerRegistry:
    def __init__(self) -> None:
        self._handlers: Dict[str, OutboxHandler] = {}

    def register(self, name: str, handler: OutboxHandler) -> None:
        if not name:
            raise ValueError("Outbox handler name must not be empty")
        if name in self._handlers:
            raise ValueError(f"Outbox handler already registered: {name}")
        self._handlers[name] = handler

    def get(self, name: str) -> OutboxHandler:
        try:
            return self._handlers[name]
        except KeyError as exc:
            raise ValueError(f"Unknown outbox handler: {name}") from exc

    def has(self, name):
        return name in self._handlers

    def validate_database(self, session: Session) -> None:
        rows = session.execute(
            text(
                """
                SELECT DISTINCT handler_name
                FROM core_outbox
                WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')
                """
            )
        ).fetchall()
        unknown = [str(row[0]) for row in rows if str(row[0]) not in self._handlers]
        if unknown:
            raise ValueError("Unknown outbox handlers in database: " + ", ".join(unknown))


class HttpJsonOutboxHandler:
    """Deliver an event using method/path/body from its payload."""

    def __init__(self, base_url: str, *, bearer_token: Optional[str] = None, timeout: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self.bearer_token = bearer_token
        self.timeout = timeout

    def __call__(self, event: OutboxEvent) -> DeliveryResult:
        method = str(event.payload.get("method", "POST")).upper()
        path = str(event.payload.get("path", ""))
        if not path.startswith("/"):
            raise ValueError("Outbox HTTP payload requires an absolute path")
        body = event.payload.get("body", event.payload)
        headers = {
            "Content-Type": "application/json",
            "Idempotency-Key": event.idempotency_key,
        }
        headers.update({str(k): str(v) for k, v in event.payload.get("headers", {}).items()})
        if self.bearer_token:
            headers["Authorization"] = f"Bearer {self.bearer_token}"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json_dumps(body).encode("utf-8"),
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                if raw:
                    try:
                        response_body = json_loads(raw)
                    except ValueError:
                        response_body = {"raw": raw}
                else:
                    response_body = {}
                return DeliveryResult(
                    response={"status": response.status, "body": response_body}
                )
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Core HTTP {exc.code}: {raw}") from exc


class OutboxDispatcher:
    """Claim in one transaction, deliver outside it, finalize in another."""

    def __init__(
        self,
        handlers: OutboxHandlerRegistry,
        *,
        worker_id: str = "outbox-worker",
        lock_timeout_seconds: int = 300,
        retry_base_seconds: int = 5,
        retry_max_seconds: int = 300,
    ) -> None:
        self.handlers = handlers
        self.worker_id = worker_id
        self.lock_timeout_seconds = lock_timeout_seconds
        self.retry_base_seconds = retry_base_seconds
        self.retry_max_seconds = retry_max_seconds

    def run_once(self, session_factory: SessionFactory, *, limit: int = 20) -> WorkerBatchResult:
        if self.handlers.has("ibronevik"):
            from .maintenance import maintain_invocations
            maintain_invocations(session_factory)
        self.recover_stale(session_factory)
        items: List[WorkerItemResult] = []
        for _ in range(limit):
            event = self.claim_next(session_factory)
            if event is None:
                break
            try:
                handler = self.handlers.get(event.handler_name)
                if event.handler_name == "ibronevik":
                    event = replace(event, before_write=lambda: self.mark_write_attempted(session_factory, event))
                delivery = handler(event) or DeliveryResult()
                self.mark_sent(session_factory, event, delivery)
                items.append(WorkerItemResult(item_id=event.id, ok=True))
            except Exception as exc:
                terminal = isinstance(exc, PermanentDeliveryError) or event.attempts >= event.max_attempts
                self.mark_failed(session_factory, event, exc, terminal=terminal)
                items.append(WorkerItemResult(item_id=event.id, ok=False, message=str(exc)))

        succeeded = sum(1 for item in items if item.ok)
        return WorkerBatchResult(
            processed=len(items),
            succeeded=succeeded,
            failed=len(items) - succeeded,
            items=items,
        )

    def claim_next(self, session_factory: SessionFactory) -> Optional[OutboxEvent]:
        session = session_factory()
        try:
            row = session.execute(
                text(
                    """
                    SELECT id, service, aggregate_type, aggregate_id, event_type,
                           payload, handler_name, attempts, max_attempts,
                           idempotency_key, completion_json, credentials_encrypted, write_attempted
                    FROM core_outbox
                    WHERE status IN ('PENDING', 'RETRY')
                      AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                      AND attempts < max_attempts
                    ORDER BY created_at, id
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                )
            ).fetchone()
            if row is None:
                session.commit()
                return None
            event = OutboxEvent(
                id=int(row[0]),
                service=str(row[1]),
                aggregate_type=str(row[2]),
                aggregate_id=int(row[3]),
                event_type=str(row[4]),
                payload=json_loads_object(row[5]),
                handler_name=str(row[6]),
                attempts=int(row[7]) + 1,
                max_attempts=int(row[8]),
                idempotency_key=str(row[9]),
                completion=OutboxCompletion.from_json(row[10]) if len(row) > 10 else None,
                credentials_encrypted=row[11] if len(row) > 11 else None,
                write_attempted=bool(row[12]) if len(row) > 12 else None,
            )
            session.execute(
                text(
                    """
                    UPDATE core_outbox
                    SET status = 'PROCESSING', attempts = attempts + 1,
                        locked_at = CURRENT_TIMESTAMP, locked_by = :worker_id,
                        last_error = NULL
                    WHERE id = :id
                    """
                ),
                {"id": event.id, "worker_id": self.worker_id},
            )
            session.commit()
            return event
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def mark_sent(
        self,
        session_factory: SessionFactory,
        event: OutboxEvent,
        delivery: DeliveryResult,
    ) -> None:
        self._finalize(
            session_factory,
            event,
            status="SENT",
            response=delivery.response,
            sent=True,
            completion_outcome="sent",
        )

    def mark_write_attempted(self, session_factory, event):
        """Commit the attempt marker before the network write, never afterwards."""
        with session_factory() as session:
            result = session.execute(text("UPDATE core_outbox SET write_attempted=1 WHERE id=:id AND status='PROCESSING' AND locked_by=:worker"), {"id":event.id,"worker":self.worker_id})
            if result.rowcount != 1:
                raise RuntimeError("Core write lease was lost")
            session.commit()

    def mark_failed(
        self,
        session_factory: SessionFactory,
        event: OutboxEvent,
        error: Exception,
        *,
        terminal: bool,
    ) -> None:
        delay = min(
            self.retry_base_seconds * (2 ** max(event.attempts - 1, 0)),
            self.retry_max_seconds,
        )
        message = str(error)
        if terminal and event.completion and event.completion.invocation and not isinstance(error, PermanentDeliveryError):
            message = "CORE_OUTCOME_UNKNOWN"
        self._finalize(
            session_factory,
            event,
            status="FAILED" if terminal else "RETRY",
            error=message,
            next_attempt_at=None if terminal else datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=delay),
            completion_outcome="failed" if terminal else None,
        )

    def _finalize(
        self,
        session_factory: SessionFactory,
        event: OutboxEvent,
        *,
        status: str,
        error: Optional[str] = None,
        response: Optional[Dict[str, Any]] = None,
        next_attempt_at: Optional[datetime] = None,
        sent: bool = False,
        completion_outcome: Optional[str] = None,
    ) -> None:
        session = session_factory()
        try:
            result = session.execute(
                text(
                    """
                    UPDATE core_outbox
                    SET status = :status,
                        locked_at = NULL, locked_by = NULL,
                        last_error = :error,
                        response_json = :response_json,
                        next_attempt_at = :next_attempt_at,
                        sent_at = CASE WHEN :sent = 1 THEN CURRENT_TIMESTAMP ELSE sent_at END
                    WHERE id = :id
                      AND status = 'PROCESSING'
                      AND locked_by = :worker_id
                    """
                ),
                {
                    "id": event.id,
                    "worker_id": self.worker_id,
                    "status": status,
                    "error": error,
                    "response_json": json_dumps(response or {}),
                    "next_attempt_at": next_attempt_at,
                    "sent": 1 if sent else 0,
                },
            )
            if result.rowcount != 1:
                raise RuntimeError(f"Outbox event #{event.id} lost its processing lease")
            # The follow-up trigger is written in the same transaction as the
            # final outbox status, so a crash can neither lose it nor enqueue it
            # twice.
            if completion_outcome is not None:
                session.execute(text("UPDATE core_outbox SET credentials_encrypted=NULL WHERE id=:id"), {"id": event.id})
            if event.completion is not None and event.completion.invocation is not None and completion_outcome is not None:
                from .invocations import finalize_invocation
                finalize_invocation(session, event, response or {}, sent=sent, error=error)
            elif event.completion is not None and completion_outcome is not None:
                _enqueue_completion_trigger(
                    session,
                    service=event.service,
                    aggregate_type=event.aggregate_type,
                    aggregate_id=event.aggregate_id,
                    outbox_event_id=event.id,
                    completion=event.completion,
                    sent=completion_outcome == "sent",
                    error=error,
                )
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def recover_stale(self, session_factory: SessionFactory) -> int:
        session = session_factory()
        try:
            # Events that are about to become terminal FAILED still owe their
            # follow-up trigger; lock and collect them before the bulk update.
            exhausted = session.execute(
                text(
                    """
                    SELECT id, completion_json, service, aggregate_type, aggregate_id
                    FROM core_outbox
                    WHERE status = 'PROCESSING'
                      AND completion_json IS NOT NULL
                      AND attempts >= max_attempts
                      AND (locked_at IS NULL OR locked_at < TIMESTAMPADD(
                          SECOND, -:timeout_seconds, CURRENT_TIMESTAMP
                      ))
                    FOR UPDATE
                    """
                ),
                {"timeout_seconds": self.lock_timeout_seconds},
            ).fetchall()
            result = session.execute(
                text(
                    """
                    UPDATE core_outbox
                    SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'RETRY' END,
                        next_attempt_at = CASE
                            WHEN attempts >= max_attempts THEN NULL
                            ELSE CURRENT_TIMESTAMP
                        END,
                        locked_at = NULL, locked_by = NULL,
                        last_error = 'Outbox processing lease expired'
                    WHERE status = 'PROCESSING'
                      AND (locked_at IS NULL OR locked_at < TIMESTAMPADD(
                          SECOND, -:timeout_seconds, CURRENT_TIMESTAMP
                      ))
                    """
                ),
                {"timeout_seconds": self.lock_timeout_seconds},
            )
            for row in exhausted or []:
                completion = OutboxCompletion.from_json(row[1])
                if completion is None:
                    continue
                if completion.invocation is not None:
                    from .invocations import finalize_invocation
                    expired = OutboxEvent(int(row[0]), str(row[2]), str(row[3]), int(row[4]), "", {}, "ibronevik", 0, 0, "", completion)
                    finalize_invocation(session, expired, {}, sent=False, error="CORE_PROCESSING_LEASE_EXPIRED")
                    session.execute(text("UPDATE core_outbox SET credentials_encrypted=NULL WHERE id=:id"), {"id": row[0]})
                    continue
                _enqueue_completion_trigger(
                    session,
                    service=str(row[2]),
                    aggregate_type=str(row[3]),
                    aggregate_id=int(row[4]),
                    outbox_event_id=int(row[0]),
                    completion=completion,
                    sent=False,
                    error="Outbox processing lease expired and retry limit was reached",
                )
            session.commit()
            return int(result.rowcount or 0)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


def _enqueue_completion_trigger(
    session: Session,
    *,
    service: str,
    aggregate_type: str,
    aggregate_id: int,
    outbox_event_id: int,
    completion: OutboxCompletion,
    sent: bool,
    error: Optional[str],
) -> int:
    """Append the follow-up trigger for a finally delivered or failed event."""

    metadata: Dict[str, Any] = {"outboxEventId": outbox_event_id}
    if completion.command_instance_id is not None:
        if sent:
            metadata[COMPLETES_COMMAND_KEY] = {"instanceId": completion.command_instance_id}
        else:
            metadata[FAILS_COMMAND_KEY] = {
                "instanceId": completion.command_instance_id,
                "errorCode": "INTERNAL_ERROR",
                "errorMessage": (error or "Outbox delivery failed")[:_MAX_COMPLETION_ERROR_LENGTH],
            }
    return enqueue_fsm_instance(
        session,
        service=service,
        process_name=completion.process_name,
        entity_type=aggregate_type,
        entity_id=aggregate_id,
        trigger=Trigger(
            trigger_type="event",
            trigger_name=completion.on_sent_trigger if sent else completion.on_failed_trigger,
            payload={"outboxEventId": outbox_event_id},
        ),
        metadata=metadata,
    )
