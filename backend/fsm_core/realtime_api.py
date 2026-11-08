"""Authenticated FastAPI read/realtime adapter for FSM Platform."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

from .errors import AuthenticationError, AuthenticationUnavailable, AuthorizationError
from .realtime import list_realtime_events, realtime_channel
from .registry import RegistryError


def _principal_provider(app):
    return app.state.principal_provider


def _load_snapshot(
    app,
    *,
    principal,
    service: str,
    entity_type: str,
    entity_id: int,
):
    return app.state.snapshot_service.build(
        principal=principal,
        service=service,
        entity_type=entity_type,
        entity_id=entity_id,
    )


PING_INTERVAL_SECONDS = 25.0


async def _wait_for_disconnect(websocket: WebSocket) -> None:
    """Return as soon as the client disconnects; client messages are ignored."""
    while True:
        message = await websocket.receive()
        if message.get("type") == "websocket.disconnect":
            return


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, AuthenticationUnavailable):
        return HTTPException(status_code=503, detail="Authentication service unavailable")
    if isinstance(exc, AuthenticationError):
        return HTTPException(status_code=401, detail=str(exc))
    if isinstance(exc, AuthorizationError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=404, detail=str(exc))


def create_realtime_router() -> APIRouter:
    router = APIRouter(prefix="/api/realtime", tags=["realtime"])

    @router.get("/snapshot/{service}/{entity_type}/{entity_id}")
    async def snapshot(
        request: Request,
        service: str,
        entity_type: str,
        entity_id: int,
    ):
        try:
            principal = await asyncio.to_thread(_principal_provider(request.app).from_http, request)
            return await asyncio.to_thread(
                _load_snapshot,
                request.app,
                principal=principal,
                service=service,
                entity_type=entity_type,
                entity_id=entity_id,
            )
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, ValueError, KeyError, RegistryError) as exc:
            raise _http_error(exc) from exc

    @router.get("/events/{service}/{entity_type}/{entity_id}")
    async def events(
        request: Request,
        service: str,
        entity_type: str,
        entity_id: int,
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
    ):
        try:
            principal = await asyncio.to_thread(_principal_provider(request.app).from_http, request)

            def load():
                return request.app.state.snapshot_service.read_authorized(
                    principal=principal,
                    service=service,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    reader=lambda session: list_realtime_events(
                        session,
                        service=service,
                        entity_type=entity_type,
                        entity_id=entity_id,
                        after_id=after,
                        limit=limit,
                    ),
                )

            return {"events": await asyncio.to_thread(load)}
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, ValueError, KeyError, RegistryError) as exc:
            raise _http_error(exc) from exc

    @router.websocket("/ws/{service}/{entity_type}/{entity_id}")
    async def websocket_endpoint(
        websocket: WebSocket,
        service: str,
        entity_type: str,
        entity_id: int,
    ):
        try:
            provider = _principal_provider(websocket.app)
            if hasattr(provider, "authenticate_websocket"):
                principal = await provider.authenticate_websocket(websocket)
            else:
                principal = provider.from_websocket(websocket)
        except (AuthenticationError, AuthenticationUnavailable) as exc:
            await websocket.close(code=4401, reason=str(exc)[:120])
            return
        except WebSocketDisconnect:
            return

        core_id = entity_id if service == "taxi" and entity_type == "core-order" else None
        if core_id is not None:
            def resolve():
                from sqlalchemy import text
                with websocket.app.state.session_factory() as session:
                    return session.execute(text('SELECT local_order_id FROM core_order_mapping WHERE core_order_id=:id'), {'id':core_id}).scalar()
            local_id = await asyncio.to_thread(resolve)
            if local_id is None:
                await websocket.close(code=4404, reason="Load the order snapshot first")
                return
            entity_type, entity_id = "order", int(local_id)

        def public_snapshot(value):
            if core_id is not None:
                return dict(value, fsmOrderId=entity_id, orderId=core_id)
            return value

        try:
            initial = await asyncio.to_thread(
                _load_snapshot,
                websocket.app,
                principal=principal,
                service=service,
                entity_type=entity_type,
                entity_id=entity_id,
            )
        except AuthorizationError as exc:
            await websocket.close(code=4403, reason=str(exc)[:120])
            return
        except (ValueError, KeyError, RegistryError) as exc:
            await websocket.close(code=4404, reason=str(exc)[:120])
            return

        if not hasattr(provider, "authenticate_websocket"):
            await websocket.accept()
        channel = realtime_channel(service, entity_type, entity_id)
        try:
            async with websocket.app.state.realtime_hub.subscribe(channel) as queue:
                await websocket.send_json({"type": "snapshot", "snapshot": public_snapshot(initial)})
                # Listen for the client closing the socket; otherwise the
                # subscription outlives the client until the next ping fails.
                disconnected = asyncio.create_task(_wait_for_disconnect(websocket))
                try:
                    while True:
                        next_event = asyncio.ensure_future(queue.get())
                        done, _ = await asyncio.wait(
                            {next_event, disconnected},
                            timeout=PING_INTERVAL_SECONDS,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        if disconnected in done:
                            next_event.cancel()
                            return
                        if next_event not in done:
                            next_event.cancel()
                            if hasattr(provider, "authenticate"):
                                principal = await asyncio.to_thread(provider.authenticate, principal.credentials)
                            await websocket.send_json({"type": "ping"})
                            continue
                        event = next_event.result()
                        if hasattr(provider, "authenticate"):
                            principal = await asyncio.to_thread(provider.authenticate, principal.credentials)
                        current = await asyncio.to_thread(
                            _load_snapshot,
                            websocket.app,
                            principal=principal,
                            service=service,
                            entity_type=entity_type,
                            entity_id=entity_id,
                        )
                        await websocket.send_json(
                            {"type": "entity.updated", "event": event, "snapshot": public_snapshot(current)}
                        )
                finally:
                    disconnected.cancel()
        except WebSocketDisconnect:
            return
        except AuthorizationError:
            await websocket.close(code=4403, reason="Access revoked")
        except AuthenticationError:
            await websocket.close(code=4401, reason="Session expired")
        except Exception as exc:
            await websocket.close(code=1011, reason="Realtime service unavailable")

    return router
