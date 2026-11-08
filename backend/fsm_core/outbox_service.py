"""Long-running service for post-commit outbox delivery."""

from __future__ import annotations

import logging
import threading
from typing import Optional

from .outbox import OutboxDispatcher
from .workers import SessionFactory


logger = logging.getLogger(__name__)


class OutboxService:
    def __init__(
        self,
        dispatcher: OutboxDispatcher,
        session_factory: SessionFactory,
        *,
        batch_size: int = 20,
        poll_interval_seconds: float = 1.0,
        error_interval_seconds: float = 5.0,
    ) -> None:
        self.dispatcher = dispatcher
        self.session_factory = session_factory
        self.batch_size = batch_size
        self.poll_interval_seconds = poll_interval_seconds
        self.error_interval_seconds = error_interval_seconds

    def run_forever(self, stop_event: Optional[threading.Event] = None) -> None:
        stop = stop_event or threading.Event()
        logger.info("Outbox worker %s started", self.dispatcher.worker_id)
        while not stop.is_set():
            try:
                result = self.dispatcher.run_once(self.session_factory, limit=self.batch_size)
                if result.processed:
                    logger.info(
                        "Outbox batch: processed=%d succeeded=%d failed=%d",
                        result.processed,
                        result.succeeded,
                        result.failed,
                    )
                    continue
                stop.wait(self.poll_interval_seconds)
            except Exception:  # pragma: no cover
                logger.exception("Outbox polling cycle failed")
                stop.wait(self.error_interval_seconds)
        logger.info("Outbox worker %s stopped", self.dispatcher.worker_id)

