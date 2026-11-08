"""Stored-procedure bridge for the table-driven FSM engine.

This module deliberately does not create, commit, roll back, or close a
SQLAlchemy session. The worker owns the transaction boundary and passes the
active session into domain actions/repositories.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from .errors import FsmError


class FsmProcedureError(FsmError):
    """Raised when the FSM stored procedure rejects or cannot run an action."""


@dataclass(frozen=True)
class FsmProcedureResult:
    """Normalized result returned by fsm_perform_action."""

    ok: bool
    message: str
    code: str = "OK"


def call_fsm_action(
    session: Session,
    entity_type: str,
    entity_id: int,
    action_name: str,
    user_id: int,
    extra_id: Optional[str] = None,
    expected_state: Optional[str] = None,
    service: Optional[str] = None,
) -> FsmProcedureResult:
    """Apply an FSM transition inside the caller-owned transaction.

    MySQL stored procedures can leave unread result sets. We consume them all
    before returning so the same DBAPI connection remains usable by the session.

    Runtime calls ``fsm_perform_action_v2`` with ``expected_state``. The old
    five-argument procedure remains available only for legacy facades while a
    domain is being migrated to FSM Platform.
    """

    safe_extra_id = extra_id if extra_id is not None else ""
    cursor = None

    try:
        dbapi_connection = session.connection().connection
        cursor = dbapi_connection.cursor()
        if expected_state is None:
            procedure_name = "fsm_perform_action"
            arguments = [entity_type, entity_id, action_name, user_id, safe_extra_id]
        else:
            if not service:
                raise FsmProcedureError("service is required for fsm_perform_action_v2")
            procedure_name = "fsm_perform_action_v2"
            arguments = [
                service,
                entity_type,
                entity_id,
                action_name,
                expected_state,
                user_id,
                safe_extra_id,
            ]
        cursor.callproc(procedure_name, arguments)

        rows = []
        for result in cursor.stored_results():
            rows.extend(result.fetchall())

        while cursor.nextset():
            pass

        if not rows:
            raise FsmProcedureError("fsm_perform_action returned no result")

        first_row = rows[0]
        if len(first_row) >= 2:
            code = str(first_row[0])
            message = str(first_row[1])
            if code == "OK":
                return FsmProcedureResult(ok=True, message=message, code=code)
            raise FsmProcedureError(f"{code}: {message}")

        message = str(first_row[0])
        if message.startswith("ERROR"):
            raise FsmProcedureError(message)
        if message.startswith("FSM action ") or "FSM action completed" in message:
            return FsmProcedureResult(ok=True, message=message, code="OK")

        raise FsmProcedureError(message)
    except FsmProcedureError:
        raise
    except Exception as exc:  # pragma: no cover - driver-specific exceptions
        raise FsmProcedureError(f"FSM {action_name} failed: {exc}") from exc
    finally:
        if cursor is not None:
            cursor.close()
