"""Authentication and entity-level authorization contracts for Domain API."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional, Protocol, Tuple

from sqlalchemy.orm import Session

from .errors import AuthenticationError


@dataclass(frozen=True)
class Principal:
    user_id: int
    roles: Tuple[str, ...]
    subject: Optional[str] = None
    credentials: Any = field(default=None, repr=False, compare=False)

    @property
    def primary_role(self) -> str:
        return self.roles[0] if self.roles else ""

    def has_role(self, *roles: str) -> bool:
        expected = set(roles)
        return any(role in expected for role in self.roles)


class PrincipalProvider(Protocol):
    def from_http(self, request: Any) -> Principal:
        ...

    def from_websocket(self, websocket: Any) -> Principal:
        ...


class EntityAccessPolicy(Protocol):
    def __call__(
        self,
        session: Session,
        *,
        principal: Principal,
        entity_type: str,
        entity_id: int,
    ) -> bool:
        ...


class CommandPolicy(Protocol):
    """Intent-level rule checked when a command is accepted.

    Runs after the entity access policy, so it may assume the principal can
    see the entity. Receives a read-only session.
    """

    def __call__(
        self,
        session: Session,
        *,
        principal: Principal,
        entity_type: str,
        entity_id: int,
        intent: str,
    ) -> bool:
        ...


class ScopePrincipalProvider:
    """Read a principal installed by trusted host authentication middleware."""

    state_key = "principal"

    def from_http(self, request: Any) -> Principal:
        return self._read(request.scope)

    def from_websocket(self, websocket: Any) -> Principal:
        return self._read(websocket.scope)

    def _read(self, scope: Mapping[str, Any]) -> Principal:
        state = scope.get("state") or {}
        principal = state.get(self.state_key)
        if not isinstance(principal, Principal):
            raise AuthenticationError("Authenticated principal is required")
        return principal


class ApiKeyPrincipalProvider:
    """Authenticate Bearer API keys using server-side configured identities."""

    def __init__(self, identities: Mapping[str, Principal]):
        if not identities:
            raise ValueError("At least one API identity is required")
        self._identities = dict(identities)

    @classmethod
    def from_json(cls, value: str) -> "ApiKeyPrincipalProvider":
        raw = json.loads(value)
        if not isinstance(raw, dict):
            raise ValueError("FSM_API_KEYS_JSON must be an object")
        identities: Dict[str, Principal] = {}
        for token, config in raw.items():
            if not isinstance(config, dict):
                raise ValueError("Each API key identity must be an object")
            roles = config.get("roles") or []
            if not isinstance(roles, list) or not roles:
                raise ValueError("Each API key identity requires non-empty roles")
            identities[str(token)] = Principal(
                user_id=int(config["userId"]),
                roles=tuple(str(role) for role in roles),
                subject=str(config.get("subject") or config["userId"]),
            )
        return cls(identities)

    def from_http(self, request: Any) -> Principal:
        return self._authenticate(request.headers.get("authorization"))

    def from_websocket(self, websocket: Any) -> Principal:
        return self._authenticate(websocket.headers.get("authorization"))

    def _authenticate(self, authorization: Optional[str]) -> Principal:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise AuthenticationError("Bearer token is required")
        principal = self._identities.get(token)
        if principal is None:
            raise AuthenticationError("Invalid Bearer token")
        return principal
