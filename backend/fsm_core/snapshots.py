"""Read-only snapshot execution and entity authorization."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .errors import AuthorizationError
from .registry import FsmRegistry
from .security import Principal


class ReadOnlySession:
    """A narrow Session proxy that rejects mutation and transaction ownership."""

    _MUTATING_PREFIXES = (
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "REPLACE ",
        "ALTER ",
        "CREATE ",
        "DROP ",
        "TRUNCATE ",
        "CALL ",
    )

    def __init__(self, session: Session):
        self._session = session

    def execute(self, statement, params=None, *args, **kwargs):
        sql = str(statement).lstrip().upper()
        if sql.startswith(self._MUTATING_PREFIXES):
            raise RuntimeError("SnapshotBuilder cannot execute mutating SQL")
        return self._session.execute(statement, params or {}, *args, **kwargs)

    def commit(self):
        raise RuntimeError("SnapshotBuilder cannot commit")

    def flush(self, *args, **kwargs):
        raise RuntimeError("SnapshotBuilder cannot flush")

    def add(self, *args, **kwargs):
        raise RuntimeError("SnapshotBuilder cannot add entities")

    def add_all(self, *args, **kwargs):
        raise RuntimeError("SnapshotBuilder cannot add entities")

    def delete(self, *args, **kwargs):
        raise RuntimeError("SnapshotBuilder cannot delete entities")

    def merge(self, *args, **kwargs):
        raise RuntimeError("SnapshotBuilder cannot merge entities")

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)


class SnapshotService:
    def __init__(self, registry: FsmRegistry, session_factory):
        self.registry = registry
        self.session_factory = session_factory

    def build(
        self,
        *,
        principal: Principal,
        service: str,
        entity_type: str,
        entity_id: int,
    ):
        def build_with_session(read_session):
            builder = self.registry.get_snapshot_builder(service, entity_type)
            return builder(
                read_session,
                entity_type=entity_type,
                entity_id=entity_id,
                principal=principal,
            )
        return self.read_authorized(
            principal=principal,
            service=service,
            entity_type=entity_type,
            entity_id=entity_id,
            reader=build_with_session,
        )

    def authorize(
        self,
        *,
        principal: Principal,
        service: str,
        entity_type: str,
        entity_id: int,
    ) -> None:
        self.read_authorized(
            principal=principal,
            service=service,
            entity_type=entity_type,
            entity_id=entity_id,
            reader=lambda session: None,
        )

    def read_authorized(
        self,
        *,
        principal: Principal,
        service: str,
        entity_type: str,
        entity_id: int,
        reader,
    ):
        session = self.session_factory()
        read_session = ReadOnlySession(session)
        try:
            policy = self.registry.get_access_policy(service, entity_type)
            if not policy(
                read_session,
                principal=principal,
                entity_type=entity_type,
                entity_id=entity_id,
            ):
                raise AuthorizationError(
                    f"Access denied to {service}/{entity_type}/{entity_id}"
                )
            return reader(read_session)
        finally:
            session.rollback()
            session.close()
