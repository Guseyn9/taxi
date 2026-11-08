"""Command-line composition root for the multi-domain FSM worker."""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading

from domains.courier import register_courier_processes
from domains.taxi.processes import register_taxi_processes
from fsm_core import FsmEngine, FsmInstanceWorker, FsmRegistry, FsmWorkerService
from fsm_core.database import build_session_factory_from_env
from fsm_core.realtime import record_transition_event


def build_session_factory():
    return build_session_factory_from_env()


def build_registry(*, external_sync=None) -> FsmRegistry:
    registry = FsmRegistry()
    register_courier_processes(registry)
    register_taxi_processes(registry)
    registry.external_sync_enabled = external_sync if external_sync is not None else os.getenv("FSM_EXTERNAL_SYNC_ENABLED", "1") == "1"
    if registry.external_sync_enabled:
        from domains.taxi.invocations import build_core_request, ACTION_TO_CORE
        from domains.taxi.fsm_spec import ORDER_TRANSITIONS
        registry.register_request_builder("taxi_core_request", build_core_request)
        registry.required_external_transitions = {('taxi','order',t.from_state,t.action,t.to_state) for t in ORDER_TRANSITIONS if t.action in ACTION_TO_CORE}
    return registry


def build_service() -> FsmWorkerService:
    session_factory = build_session_factory()
    registry = build_registry()
    if not registry.external_sync_enabled and os.getenv("FSM_ENV") != "test":
        raise RuntimeError("External synchronization can be disabled only in tests")
    session = session_factory()
    try:
        report = registry.validate_database(session)
        logging.getLogger(__name__).info(
            "FSM Registry validated: %s transition bindings, %s active process types",
            report.checked_transitions,
            report.checked_instances,
        )
    finally:
        session.close()

    worker_id = os.getenv("FSM_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    worker = FsmInstanceWorker(
        FsmEngine(
            registry,
            transition_event_recorder=(
                record_transition_event
                if os.getenv("FSM_REALTIME_ENABLED", "1") == "1"
                else None
            ),
        ),
        worker_id=worker_id,
        max_attempts=int(os.getenv("FSM_WORKER_MAX_ATTEMPTS", "3")),
        lock_timeout_seconds=int(os.getenv("FSM_WORKER_LOCK_TIMEOUT_SECONDS", "300")),
    )
    return FsmWorkerService(
        worker,
        session_factory,
        batch_size=int(os.getenv("FSM_WORKER_BATCH_SIZE", "20")),
        poll_interval_seconds=float(os.getenv("FSM_WORKER_POLL_SECONDS", "1")),
        error_interval_seconds=float(os.getenv("FSM_WORKER_ERROR_SECONDS", "5")),
        system_user_id=int(os.getenv("FSM_SYSTEM_USER_ID", "0")),
    )


def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    stop_event = threading.Event()

    def request_stop(signum, frame) -> None:
        del signum, frame
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    build_service().run_forever(stop_event)


if __name__ == "__main__":
    main()
