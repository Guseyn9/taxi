"""Long-running host for the generic FSM instance worker."""

from __future__ import annotations

import logging
import threading
from typing import Optional

from .workers import FsmInstanceWorker, SessionFactory


logger = logging.getLogger(__name__)


class FsmWorkerService:
    """Poll pending instances until a stop event is set."""

    def __init__(
        self,
        worker: FsmInstanceWorker,
        session_factory: SessionFactory,
        *,
        batch_size: int = 20,
        poll_interval_seconds: float = 1.0,
        error_interval_seconds: float = 5.0,
        system_user_id: int = 0,
    ) -> None:
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1")
        if poll_interval_seconds <= 0 or error_interval_seconds <= 0:
            raise ValueError("worker intervals must be positive")
        self.worker = worker
        self.session_factory = session_factory
        self.batch_size = batch_size
        self.poll_interval_seconds = poll_interval_seconds
        self.error_interval_seconds = error_interval_seconds
        self.system_user_id = system_user_id

    def run_forever(self, stop_event: Optional[threading.Event] = None) -> None:
        stop = stop_event or threading.Event()
        logger.info("FSM worker %s started", self.worker.worker_id)
        while not stop.is_set():
            try:
                result = self.worker.run_once(
                    self.session_factory,
                    limit=self.batch_size,
                    system_user_id=self.system_user_id,
                )
                if result.processed:
                    logger.info(
                        "FSM worker batch: processed=%d succeeded=%d failed=%d",
                        result.processed,
                        result.succeeded,
                        result.failed,
                    )
                    continue
                stop.wait(self.poll_interval_seconds)
            except Exception:  # pragma: no cover - service boundary logging
                logger.exception("FSM worker polling cycle failed")
                stop.wait(self.error_interval_seconds)
        logger.info("FSM worker %s stopped", self.worker.worker_id)

