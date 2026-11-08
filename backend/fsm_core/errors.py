"""Common exception hierarchy for FSM Platform."""

from fsm.errors import FsmError


class TransitionNotFound(FsmError):
    """No transition matches the current state and resolved action."""


class GuardRejected(FsmError):
    """A domain guard rejected the transition."""


class EffectFailed(FsmError):
    """A domain effect failed after SQL Core applied the transition."""


class ProcessEntityMismatch(FsmError):
    """A process was invoked for an unsupported entity type."""


class InstanceEnqueueError(FsmError):
    """A trigger could not be persisted for worker processing."""


class AuthenticationError(FsmError):
    """No valid authenticated principal is available."""


class AuthenticationUnavailable(FsmError):
    """Identity cannot currently be checked; do not treat an outage as logout."""


class EntitySyncInProgress(FsmError):
    """An entity is awaiting Core confirmation or reconciliation."""


class AuthorizationError(FsmError):
    """The authenticated principal cannot access the requested entity."""


class CommandNotFoundError(FsmError):
    """Requested command instance was not found."""


# Note: CommandPendingError / CommandProcessingError / CommandFailedError
# were removed. The Command Completion API returns status as data
# (200 PENDING / 200 PROCESSING / 200 COMPLETED / 200 FAILED), not as HTTP
# exceptions. ``errorCode`` is the machine-readable failure indicator.
