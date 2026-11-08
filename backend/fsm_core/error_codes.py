"""Map runtime exceptions to machine-readable command ``errorCode`` values.

TASK-CORE-001 §7 requires a documented, closed set of machine error codes for
the ``FAILED`` terminal state of command executions. Worker uses
``classify_exception(exc)`` when recording a failure on
``fsm_command_idempotency``.

Public errorCode vocabulary (part of the API contract, documented in README):

* ``INVALID_TRANSITION`` — FSM rejected the transition
  (stale expected_state, unknown action/state, transition not declared).
* ``UNKNOWN_ENTITY`` — entity type unknown to SQL Core, or process/entity
  mismatch.
* ``INVALID_PARAMETERS`` — envelope validation, payload validation, intent
  resolution failure.
* ``AUTHORIZATION_FAILED`` — principal lacks access to the entity.
* ``CORE_AUTHENTICATION_REQUIRED`` — Core refused the initiator session before a write.
* ``INTERNAL_ERROR`` — anything else. Acts as the catch-all.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .errors import (
    AuthenticationError,
    AuthorizationError,
    EffectFailed,
    GuardRejected,
    ProcessEntityMismatch,
    EntitySyncInProgress,
)
from fsm.errors import FsmError
from fsm.procedure import FsmProcedureError


# CommandValidationError is defined in command_service; import lazily to avoid
# circular import (command_service imports from error_codes indirectly through
# workers, but error_codes itself does not need command_service at runtime).
def _is_command_validation_error(exc: BaseException) -> bool:
    try:
        from .command_service import CommandValidationError
    except ImportError:
        return False
    return isinstance(exc, CommandValidationError)


INVALID_TRANSITION = "INVALID_TRANSITION"
UNKNOWN_ENTITY = "UNKNOWN_ENTITY"
INVALID_PARAMETERS = "INVALID_PARAMETERS"
AUTHORIZATION_FAILED = "AUTHORIZATION_FAILED"
CORE_AUTHENTICATION_REQUIRED = "CORE_AUTHENTICATION_REQUIRED"
INTERNAL_ERROR = "INTERNAL_ERROR"
ENTITY_SYNC_IN_PROGRESS = "ENTITY_SYNC_IN_PROGRESS"


KNOWN_ERROR_CODES = frozenset(
    {
        INVALID_TRANSITION,
        UNKNOWN_ENTITY,
        INVALID_PARAMETERS,
        AUTHORIZATION_FAILED,
        CORE_AUTHENTICATION_REQUIRED,
        INTERNAL_ERROR,
        ENTITY_SYNC_IN_PROGRESS,
        "CORE_REJECTED", "CORE_OUTCOME_UNKNOWN", "CORE_FSM_DIVERGENCE",
    }
)


@dataclass(frozen=True)
class ClassifiedError:
    code: str
    message: str


def _coerce_message(exc: BaseException) -> str:
    return str(exc) or exc.__class__.__name__


def classify_exception(exc: BaseException) -> ClassifiedError:
    """Map any exception to a ``(errorCode, message)`` pair."""

    if isinstance(exc, EntitySyncInProgress):
        return ClassifiedError(ENTITY_SYNC_IN_PROGRESS, "Entity is awaiting Core confirmation")
    if isinstance(exc, AuthenticationError):
        return ClassifiedError(AUTHORIZATION_FAILED, _coerce_message(exc))

    if isinstance(exc, AuthorizationError):
        return ClassifiedError(AUTHORIZATION_FAILED, _coerce_message(exc))

    if isinstance(exc, ProcessEntityMismatch):
        return ClassifiedError(UNKNOWN_ENTITY, _coerce_message(exc))

    if _is_command_validation_error(exc):
        return ClassifiedError(INVALID_PARAMETERS, _coerce_message(exc))

    if isinstance(exc, (GuardRejected, EffectFailed)):
        # Guards/effects reject the transition with a domain reason; expose as
        # INVALID_TRANSITION because the transition did not complete.
        return ClassifiedError(INVALID_TRANSITION, _coerce_message(exc))

    if isinstance(exc, FsmProcedureError):
        # The stored procedure returns machine-readable codes such as
        # ``INVALID_TRANSITION``, ``UNKNOWN_ACTION_OR_STATE``,
        # ``TRANSITION_CONFLICT``, ``UNKNOWN_ENTITY_TYPE``,
        # ``INVALID_ENTITY_BINDING``, ``SQL_ERROR``. Map them to the public
        # vocabulary.
        return _classify_procedure_error(exc)

    if isinstance(exc, FsmError):
        # Generic FSM error not handled above.
        return ClassifiedError(INTERNAL_ERROR, _coerce_message(exc))

    if isinstance(exc, (ValueError, KeyError)):
        return ClassifiedError(INVALID_PARAMETERS, _coerce_message(exc))

    return ClassifiedError(INTERNAL_ERROR, _coerce_message(exc))


def _classify_procedure_error(exc: FsmProcedureError) -> ClassifiedError:
    text_msg = _coerce_message(exc)
    upper = text_msg.upper()

    if "TRANSITION_CONFLICT" in upper or "INVALID_TRANSITION" in upper:
        return ClassifiedError(INVALID_TRANSITION, text_msg)
    if "UNKNOWN_ACTION_OR_STATE" in upper or "UNKNOWN_ENTITY_TYPE" in upper:
        return ClassifiedError(UNKNOWN_ENTITY, text_msg)
    if "INVALID_ENTITY_BINDING" in upper:
        return ClassifiedError(UNKNOWN_ENTITY, text_msg)
    if "SQL_ERROR" in upper:
        return ClassifiedError(INTERNAL_ERROR, text_msg)
    # Default for procedure errors: treat as transition-level failure.
    return ClassifiedError(INVALID_TRANSITION, text_msg)


def normalize_known_code(code: Optional[str]) -> str:
    """Return ``code`` if it is part of the public vocabulary, else
    ``INTERNAL_ERROR``."""

    if code and code in KNOWN_ERROR_CODES:
        return code
    return INTERNAL_ERROR
