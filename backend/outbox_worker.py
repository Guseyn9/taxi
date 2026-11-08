"""Command-line composition root for post-commit Core outbox delivery."""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading

from fsm_core.database import build_session_factory_from_env
from fsm_core.outbox import HttpJsonOutboxHandler, OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.outbox_service import OutboxService


def build_service() -> OutboxService:
    handlers = OutboxHandlerRegistry()
    from domains.taxi.invocations import IbronevikOutboxHandler
    from fsm_core.core_client import CoreClient, CredentialCipher
    handlers.register("ibronevik", IbronevikOutboxHandler(CoreClient.from_env(), CredentialCipher.from_env()))
    # Other domains can retain their existing JSON adapter explicitly.
    if os.getenv("CORE_API_URL"):
        handlers.register("core_http", HttpJsonOutboxHandler(os.environ["CORE_API_URL"], bearer_token=os.getenv("CORE_API_TOKEN")))
    session_factory = build_session_factory_from_env()
    session = session_factory()
    try:
        handlers.validate_database(session)
    finally:
        session.close()
    worker_id = os.getenv("OUTBOX_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    dispatcher = OutboxDispatcher(
        handlers,
        worker_id=worker_id,
        lock_timeout_seconds=int(os.getenv("OUTBOX_LOCK_TIMEOUT_SECONDS", "300")),
    )
    return OutboxService(
        dispatcher,
        session_factory,
        batch_size=int(os.getenv("OUTBOX_BATCH_SIZE", "20")),
        poll_interval_seconds=float(os.getenv("OUTBOX_POLL_SECONDS", "1")),
    )


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    stop_event = threading.Event()

    def request_stop(signum, frame):
        del signum, frame
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    build_service().run_forever(stop_event)


if __name__ == "__main__":
    main()
