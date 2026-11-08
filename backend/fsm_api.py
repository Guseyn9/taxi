"""Domain snapshot, command and realtime API composition root."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from domains.taxi.intents import TaxiIntentCatalog
from domains.taxi.create_api import create_taxi_router
from fsm_core.command_api import create_command_router
from fsm_core.command_service import CommandService
from fsm_core.database import build_session_factory_from_env
from fsm_core.realtime import (
    InMemoryRealtimeHub,
    RedisRealtimeHub,
    RealtimePublisher,
    run_realtime_publisher,
)
from fsm_core.realtime_api import create_realtime_router
from fsm_core.security import ApiKeyPrincipalProvider, ScopePrincipalProvider
from fsm_core.snapshots import SnapshotService
from fsm_worker import build_registry


def build_realtime_hub():
    queue_size = int(os.getenv("FSM_REALTIME_QUEUE_SIZE", "100"))
    backend = os.getenv("FSM_REALTIME_BACKEND", "memory").lower()
    if backend == "memory":
        return InMemoryRealtimeHub(queue_size=queue_size)
    if backend == "redis":
        return RedisRealtimeHub.from_url(
            os.getenv("FSM_REDIS_URL", "redis://localhost:6379/0"),
            queue_size=queue_size,
            channel_prefix=os.getenv("FSM_REALTIME_CHANNEL_PREFIX", "fsm:realtime:"),
        )
    raise ValueError(f"Unsupported FSM_REALTIME_BACKEND: {backend}")


def build_principal_provider():
    mode = os.getenv("FSM_AUTH_MODE", "ibronevik")
    if mode == "ibronevik":
        from fsm_core.core_auth import IbronevikPrincipalProvider
        from fsm_core.core_client import CoreClient, CredentialCipher
        CredentialCipher.from_env()  # Fail before accepting requests if worker cannot store credentials.
        return IbronevikPrincipalProvider(CoreClient.from_env())
    if mode not in {"test-api-key", "scope"}:
        raise RuntimeError("Unsupported FSM_AUTH_MODE")
    api_keys = os.getenv("FSM_API_KEYS_JSON")
    if mode == "test-api-key" and os.getenv("FSM_ENV") == "test" and api_keys:
        return ApiKeyPrincipalProvider.from_json(api_keys)
    if mode == "scope" and os.getenv("FSM_ENV") == "test":
        return ScopePrincipalProvider()
    raise RuntimeError("Test identity providers require FSM_ENV=test")


@asynccontextmanager
async def lifespan(app: FastAPI):
    session_factory = build_session_factory_from_env()
    registry = build_registry()
    if not registry.external_sync_enabled and os.getenv("FSM_ENV") != "test":
        raise RuntimeError("External synchronization can be disabled only in tests")
    session = session_factory()
    try:
        registry.validate_database(session)
    finally:
        session.close()

    provider = build_principal_provider()
    hub = build_realtime_hub()
    publisher = RealtimePublisher(
        hub,
        worker_id=os.getenv("FSM_REALTIME_WORKER_ID", "realtime-api"),
    )
    stop_event = asyncio.Event()
    task = asyncio.create_task(
        run_realtime_publisher(
            publisher,
            session_factory,
            stop_event,
            batch_size=int(os.getenv("FSM_REALTIME_BATCH_SIZE", "100")),
            poll_interval_seconds=float(os.getenv("FSM_REALTIME_POLL_SECONDS", "0.5")),
        )
    )
    snapshot_service = SnapshotService(registry, session_factory)
    app.state.session_factory = session_factory
    app.state.fsm_registry = registry
    app.state.realtime_hub = hub
    app.state.snapshot_service = snapshot_service
    app.state.command_service = CommandService(
        snapshot_service,
        {"taxi": TaxiIntentCatalog()},
        idempotency_ttl_hours=int(os.getenv("FSM_COMMAND_IDEMPOTENCY_TTL_HOURS", "24")),
    )
    app.state.principal_provider = provider
    app.state.core_client = getattr(app.state.principal_provider, "client", None)
    try:
        yield
    finally:
        stop_event.set()
        await task
        close = getattr(hub, "close", None)
        if close is not None:
            await close()
        if app.state.core_client is not None:
            app.state.core_client.close()


app = FastAPI(title="FSM Platform Domain API", version="5.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[v.strip() for v in os.getenv("FSM_CORS_ORIGINS", "http://localhost:3000").split(",") if v.strip()], allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Idempotency-Key", "X-Auth-Token", "X-Auth-U-Hash"])
app.include_router(create_realtime_router())
app.include_router(create_command_router())
app.include_router(create_taxi_router())


@app.middleware("http")
async def prevent_domain_response_caching(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "realtime": "enabled", "commands": "enabled"}
