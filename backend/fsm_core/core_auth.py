"""User session authentication shared by REST and first-message WebSocket auth."""
from __future__ import annotations
import asyncio
import hashlib
import threading
import time
from collections import OrderedDict

from .core_client import UserCredentials
from .security import Principal
from .errors import AuthenticationError


class IbronevikPrincipalProvider:
    def __init__(self, client, *, cache_seconds=60, max_entries=1024):
        self.client = client
        self.cache_seconds = min(60, max(0, cache_seconds))
        self.max_entries = max_entries
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def authenticate(self, credentials):
        digest = hashlib.sha256((credentials.token + "\0" + credentials.u_hash).encode()).digest()
        with self.lock:
            cached = self.cache.get(digest)
            if cached and cached[0] > time.monotonic():
                return Principal(cached[1], (cached[2],), credentials=credentials)
        uid, role = self.client.authorize(credentials)
        with self.lock:
            self.cache[digest] = (time.monotonic() + self.cache_seconds, uid, role)
            while len(self.cache) > self.max_entries:
                self.cache.popitem(last=False)
        return Principal(uid, (role,), credentials=credentials)

    def from_http(self, request):
        return self.authenticate(UserCredentials(request.headers.get("x-auth-token", ""), request.headers.get("x-auth-u-hash", "")))

    async def authenticate_websocket(self, websocket):
        if any(key.lower() in {"token", "u_hash", "authorization", "access_token"} for key in websocket.query_params):
            raise AuthenticationError("Credentials must be sent in the first auth message")
        await websocket.accept()
        try:
            message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
            if not isinstance(message, dict) or message.get("type") != "auth":
                raise AuthenticationError("First message must authenticate the session")
            credentials = UserCredentials(message.get("token", ""), message.get("u_hash", ""))
            return await asyncio.to_thread(self.authenticate, credentials)
        except (asyncio.TimeoutError, ValueError, TypeError):
            raise AuthenticationError("WebSocket authentication failed") from None
