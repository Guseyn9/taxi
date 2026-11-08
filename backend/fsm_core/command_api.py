"""Authenticated FastAPI Command API adapter."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

from .command_idempotency import CommandStatusError
from .command_service import (
    CommandService,
    CommandValidationError,
    parse_command_envelope,
)
from .errors import AuthenticationError, AuthenticationUnavailable, EntitySyncInProgress, AuthorizationError, CommandNotFoundError
from .registry import RegistryError


def _principal_provider(app):
    return app.state.principal_provider


def _command_service(app) -> CommandService:
    return app.state.command_service


def _session_factory(app):
    return app.state.session_factory


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, EntitySyncInProgress):
        return HTTPException(status_code=409, detail={"errorCode": "ENTITY_SYNC_IN_PROGRESS", "message": str(exc)})
    if isinstance(exc, AuthenticationUnavailable):
        return HTTPException(status_code=503, detail="Authentication service unavailable", headers={"Retry-After": "5"})
    if isinstance(exc, AuthenticationError):
        return HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, AuthorizationError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, (CommandValidationError, CommandStatusError)):
        # 400 Bad Request — the client supplied an invalid status, an
        # unsupported transition, or an invalid envelope. These are
        # programmer/caller errors, not server-side failures.
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, CommandNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ValueError, KeyError, RegistryError)):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=500, detail="Internal command error")


def create_command_router() -> APIRouter:
    router = APIRouter(prefix="/api/commands", tags=["commands"])

    @router.get('/by-key/{service}/{key}')
    async def command_by_key(request: Request, service: str, key: str):
        try:
            principal = await asyncio.to_thread(_principal_provider(request.app).from_http, request)
            def run():
                from .command_idempotency import get_command_idempotency
                with _session_factory(request.app)() as session:
                    record = get_command_idempotency(session,service=service,key=key)
                    if record is None:
                        raise CommandNotFoundError('Command receipt not found')
                    stored = record.get('response') or {}
                    if stored.get('requestedByUserId') != principal.user_id:
                        raise AuthorizationError('Command receipt belongs to another user')
                    result = _command_service(request.app)._build_duplicate_response(session,record)
                    if result is None:
                        raise CommandNotFoundError('Command receipt expired')
                    return result
            return _status_response(await asyncio.to_thread(run),status_code=200)
        except (AuthenticationError,AuthenticationUnavailable,AuthorizationError,CommandNotFoundError) as exc:
            raise _http_error(exc) from exc

    @router.post("/{service}/{entity_type}/{entity_id}")
    async def accept_command(
        request: Request,
        service: str,
        entity_type: str,
        entity_id: int,
    ):
        try:
            principal = await asyncio.to_thread(_principal_provider(request.app).from_http, request)
            body = await request.json()
            envelope = parse_command_envelope(
                body if isinstance(body, dict) else {},
                idempotency_header=request.headers.get("idempotency-key"),
            )

            def run():
                session = _session_factory(request.app)()
                try:
                    result = _command_service(request.app).accept(
                        session,
                        principal=principal,
                        service=service,
                        entity_type=entity_type,
                        entity_id=entity_id,
                        envelope=envelope,
                    )
                    if result.duplicate:
                        session.rollback()
                    else:
                        session.commit()
                    return result
                except Exception:
                    session.rollback()
                    raise
                finally:
                    session.close()

            result = await asyncio.to_thread(run)
            status_code = 200 if result.duplicate else 202
            return _status_response(result.response, status_code=status_code)
        except (
            AuthenticationError,
            AuthenticationUnavailable,
            EntitySyncInProgress,
            AuthorizationError,
            CommandNotFoundError,
            CommandStatusError,
            CommandValidationError,
            ValueError,
            KeyError,
            RegistryError,
        ) as exc:
            raise _http_error(exc) from exc

    @router.get("/{instanceId}")
    async def get_command_status(
        request: Request,
        instanceId: int,
    ):
        try:
            principal = await asyncio.to_thread(_principal_provider(request.app).from_http, request)

            def run():
                session = _session_factory(request.app)()
                try:
                    status = _command_service(request.app).get_command_status(
                        session,
                        instance_id=instanceId,
                        principal=principal,
                    )
                    if status is None:
                        raise CommandNotFoundError(
                            f"Command with instanceId {instanceId} not found"
                        )
                    return status
                except Exception:
                    session.rollback()
                    raise
                finally:
                    session.close()

            result = await asyncio.to_thread(run)
            return _status_response(result, status_code=200)
        except (
            AuthenticationError,
            AuthenticationUnavailable,
            EntitySyncInProgress,
            AuthorizationError,
            CommandNotFoundError,
            CommandStatusError,
        ) as exc:
            raise _http_error(exc) from exc

    return router


def _status_response(payload: dict, *, status_code: int):
    from fastapi.responses import JSONResponse

    return JSONResponse(content=payload, status_code=status_code)
