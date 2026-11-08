"""Durable realtime events and an in-process fan-out hub."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncContextManager, AsyncIterator, Dict, List, Optional, Protocol, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

from .serialization import json_dumps, json_loads_object
from .types import TransitionDef
from .workers import SessionFactory, WorkerBatchResult, WorkerItemResult


logger = logging.getLogger(__name__)


def realtime_channel(service: str, entity_type: str, entity_id: int) -> str:
    return f"{service}:{entity_type}:{entity_id}"


@dataclass(frozen=True)
class RealtimeEvent:
    id: int
    service: str
    entity_type: str
    entity_id: int
    event_type: str
    payload: Dict[str, Any]
    created_at: Optional[datetime] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "eventId": self.id,
            "service": self.service,
            "entityType": self.entity_type,
            "entityId": self.entity_id,
            "eventType": self.event_type,
            "payload": self.payload,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


RealtimeQueue = asyncio.Queue[Dict[str, Any]]


class RealtimeTransport(Protocol):
    def subscribe(self, channel: str) -> AsyncContextManager[RealtimeQueue]:
        ...

    async def publish(self, channel: str, message: Dict[str, Any]) -> int:
        ...


def enqueue_realtime_event(
    session: Session,
    *,
    service: str,
    entity_type: str,
    entity_id: int,
    event_type: str,
    payload: Optional[Dict[str, Any]] = None,
) -> int:
    session.execute(
        text(
            """
            INSERT INTO realtime_events (
                service, entity_type, entity_id, event_type, payload
            ) VALUES (
                :service, :entity_type, :entity_id, :event_type, :payload
            )
            """
        ),
        {
            "service": service,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "event_type": event_type,
            "payload": json_dumps(payload or {}),
        },
    )
    row = session.execute(text("SELECT LAST_INSERT_ID()"), {}).fetchone()
    return int(row[0]) if row and row[0] else 0


def record_transition_event(
    session: Session,
    *,
    service: str,
    entity_type: str,
    entity_id: int,
    transition: TransitionDef,
) -> int:
    return enqueue_realtime_event(
        session,
        service=service,
        entity_type=entity_type,
        entity_id=entity_id,
        event_type="fsm.transition",
        payload={
            "action": transition.action_name,
            "fromState": transition.from_state,
            "toState": transition.to_state,
        },
    )


class InMemoryRealtimeHub:
    def __init__(self, *, queue_size: int = 100) -> None:
        self.queue_size = queue_size
        self._subscribers: Dict[str, Set[RealtimeQueue]] = {}
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def subscribe(self, channel: str) -> AsyncIterator[RealtimeQueue]:
        queue: RealtimeQueue = asyncio.Queue(maxsize=self.queue_size)
        async with self._lock:
            self._subscribers.setdefault(channel, set()).add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                subscribers = self._subscribers.get(channel)
                if subscribers is not None:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(channel, None)

    async def publish(self, channel: str, message: Dict[str, Any]) -> int:
        async with self._lock:
            subscribers = list(self._subscribers.get(channel, set()))
        for queue in subscribers:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(dict(message))
        return len(subscribers)


# Compatibility name for callers that used Stage 4 directly.
RealtimeHub = InMemoryRealtimeHub


class RedisRealtimeHub:
    """Cross-process realtime fan-out using Redis Pub/Sub."""

    def __init__(
        self,
        redis_client,
        *,
        queue_size: int = 100,
        channel_prefix: str = "fsm:realtime:",
    ) -> None:
        self.redis = redis_client
        self.queue_size = queue_size
        self.channel_prefix = channel_prefix

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        queue_size: int = 100,
        channel_prefix: str = "fsm:realtime:",
    ) -> "RedisRealtimeHub":
        try:
            from redis.asyncio import Redis
        except ImportError as exc:
            raise RuntimeError(
                "redis package is required for FSM_REALTIME_BACKEND=redis"
            ) from exc
        return cls(
            Redis.from_url(url, decode_responses=True),
            queue_size=queue_size,
            channel_prefix=channel_prefix,
        )

    def _channel(self, channel: str) -> str:
        return f"{self.channel_prefix}{channel}"

    @asynccontextmanager
    async def subscribe(self, channel: str) -> AsyncIterator[RealtimeQueue]:
        queue: RealtimeQueue = asyncio.Queue(maxsize=self.queue_size)
        pubsub = self.redis.pubsub()
        redis_channel = self._channel(channel)
        await pubsub.subscribe(redis_channel)

        async def pump() -> None:
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    message = json_loads_object(item.get("data"))
                except (TypeError, ValueError):
                    logger.exception("Invalid realtime message on %s", redis_channel)
                    continue
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                queue.put_nowait(message)

        task = asyncio.create_task(pump())
        try:
            yield queue
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await pubsub.unsubscribe(redis_channel)
            await pubsub.aclose()

    async def publish(self, channel: str, message: Dict[str, Any]) -> int:
        return int(await self.redis.publish(self._channel(channel), json_dumps(message)))

    async def close(self) -> None:
        await self.redis.aclose()


class RealtimePublisher:
    """Publish committed realtime_events and mark them in a new transaction."""

    def __init__(
        self,
        hub: RealtimeTransport,
        *,
        worker_id: str = "realtime-publisher",
        lock_timeout_seconds: int = 300,
    ) -> None:
        self.hub = hub
        self.worker_id = worker_id
        self.lock_timeout_seconds = lock_timeout_seconds

    async def run_once(
        self,
        session_factory: SessionFactory,
        *,
        limit: int = 100,
    ) -> WorkerBatchResult:
        await asyncio.to_thread(self.recover_stale, session_factory)
        items: List[WorkerItemResult] = []
        for _ in range(limit):
            event = await asyncio.to_thread(self.claim_next, session_factory)
            if event is None:
                break
            try:
                subscribers = await self.hub.publish(
                    realtime_channel(event.service, event.entity_type, event.entity_id),
                    event.as_dict(),
                )
                await asyncio.to_thread(
                    self.mark_published,
                    session_factory,
                    event.id,
                    subscribers=subscribers,
                )
                items.append(WorkerItemResult(item_id=event.id, ok=True))
            except Exception as exc:
                await asyncio.to_thread(
                    self.mark_retry,
                    session_factory,
                    event.id,
                    str(exc),
                )
                items.append(WorkerItemResult(item_id=event.id, ok=False, message=str(exc)))
        succeeded = sum(1 for item in items if item.ok)
        return WorkerBatchResult(
            processed=len(items),
            succeeded=succeeded,
            failed=len(items) - succeeded,
            items=items,
        )

    def claim_next(self, session_factory: SessionFactory) -> Optional[RealtimeEvent]:
        session = session_factory()
        try:
            row = session.execute(
                text(
                    """
                    SELECT id, service, entity_type, entity_id, event_type,
                           payload, created_at
                    FROM realtime_events
                    WHERE status IN ('PENDING', 'RETRY')
                    ORDER BY id
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                )
            ).fetchone()
            if row is None:
                session.commit()
                return None
            event = RealtimeEvent(
                id=int(row[0]),
                service=str(row[1]),
                entity_type=str(row[2]),
                entity_id=int(row[3]),
                event_type=str(row[4]),
                payload=json_loads_object(row[5]),
                created_at=row[6],
            )
            session.execute(
                text(
                    """
                    UPDATE realtime_events
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

    def mark_published(
        self,
        session_factory: SessionFactory,
        event_id: int,
        *,
        subscribers: int,
    ) -> None:
        self._finalize(
            session_factory,
            event_id,
            status="PUBLISHED",
            subscriber_count=subscribers,
        )

    def mark_retry(self, session_factory: SessionFactory, event_id: int, error: str) -> None:
        self._finalize(session_factory, event_id, status="RETRY", error=error)

    def _finalize(
        self,
        session_factory: SessionFactory,
        event_id: int,
        *,
        status: str,
        error: Optional[str] = None,
        subscriber_count: Optional[int] = None,
    ) -> None:
        session = session_factory()
        try:
            result = session.execute(
                text(
                    """
                    UPDATE realtime_events
                    SET status = :status, locked_at = NULL, locked_by = NULL,
                        last_error = :error,
                        subscriber_count = COALESCE(:subscriber_count, subscriber_count),
                        published_at = CASE
                            WHEN :status = 'PUBLISHED' THEN CURRENT_TIMESTAMP
                            ELSE published_at
                        END
                    WHERE id = :id AND status = 'PROCESSING' AND locked_by = :worker_id
                    """
                ),
                {
                    "id": event_id,
                    "worker_id": self.worker_id,
                    "status": status,
                    "error": error,
                    "subscriber_count": subscriber_count,
                },
            )
            if result.rowcount != 1:
                raise RuntimeError(f"Realtime event #{event_id} lost its processing lease")
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def recover_stale(self, session_factory: SessionFactory) -> int:
        session = session_factory()
        try:
            result = session.execute(
                text(
                    """
                    UPDATE realtime_events
                    SET status = 'RETRY', locked_at = NULL, locked_by = NULL,
                        last_error = 'Realtime publishing lease expired'
                    WHERE status = 'PROCESSING'
                      AND (locked_at IS NULL OR locked_at < TIMESTAMPADD(
                          SECOND, -:timeout_seconds, CURRENT_TIMESTAMP
                      ))
                    """
                ),
                {"timeout_seconds": self.lock_timeout_seconds},
            )
            session.commit()
            return int(result.rowcount or 0)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


def list_realtime_events(
    session: Session,
    *,
    service: str,
    entity_type: str,
    entity_id: int,
    after_id: int = 0,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT id, service, entity_type, entity_id, event_type, payload, created_at
            FROM realtime_events
            WHERE service = :service AND entity_type = :entity_type
              AND entity_id = :entity_id AND id > :after_id
            ORDER BY id
            LIMIT :limit
            """
        ),
        {
            "service": service,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "after_id": after_id,
            "limit": min(max(limit, 1), 500),
        },
    ).fetchall()
    return [
        RealtimeEvent(
            id=int(row[0]),
            service=str(row[1]),
            entity_type=str(row[2]),
            entity_id=int(row[3]),
            event_type=str(row[4]),
            payload=json_loads_object(row[5]),
            created_at=row[6],
        ).as_dict()
        for row in rows
    ]


async def run_realtime_publisher(
    publisher: RealtimePublisher,
    session_factory: SessionFactory,
    stop_event: asyncio.Event,
    *,
    batch_size: int = 100,
    poll_interval_seconds: float = 0.5,
    error_interval_seconds: float = 2.0,
) -> None:
    logger.info("Realtime publisher %s started", publisher.worker_id)
    while not stop_event.is_set():
        try:
            result = await publisher.run_once(session_factory, limit=batch_size)
            if result.processed:
                continue
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=poll_interval_seconds)
            except asyncio.TimeoutError:
                pass
        except Exception:  # pragma: no cover - service boundary logging
            logger.exception("Realtime publishing cycle failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=error_interval_seconds)
            except asyncio.TimeoutError:
                pass
    logger.info("Realtime publisher %s stopped", publisher.worker_id)
