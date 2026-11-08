"""Deferred command completion.

By default the worker marks a command ``COMPLETED`` in the same transaction as
the FSM transition. Some transitions are only complete once an external
system (Core) confirms the side effect delivered through ``core_outbox``. Such
a transition defers completion:

1. an effect calls :func:`defer_current_command_completion` and links its
   outbox event to the running command instance;
2. the worker commits the transition, marks its own ``server_fsm_instances``
   row ``COMPLETED`` but leaves the public command status ``PROCESSING``;
3. after delivery the outbox dispatcher enqueues a follow-up trigger whose
   instance metadata links back to the original command
   (:data:`COMPLETES_COMMAND_KEY` or :data:`FAILS_COMMAND_KEY`);
4. the worker runs the follow-up transition and settles the original command
   in the same transaction.

The Runtime stays domain-neutral: trigger names and processes are supplied by
the domain effect, never hard-coded here.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator, Optional


# Keys inside ``server_fsm_instances.metadata_json`` of a follow-up instance.
COMPLETES_COMMAND_KEY = "completesCommand"
FAILS_COMMAND_KEY = "failsCommand"


@dataclass
class CommandExecution:
    """Execution state of the command instance the worker is processing."""

    instance_id: int
    deferred: bool = False
    principal: object = None


_current_execution: ContextVar[Optional[CommandExecution]] = ContextVar(
    "fsm_command_execution",
    default=None,
)


@contextmanager
def execution_scope(instance_id: int, principal=None) -> Iterator[CommandExecution]:
    """Expose the running instance to effects for the duration of one action."""

    execution = CommandExecution(instance_id=instance_id, principal=principal)
    token = _current_execution.set(execution)
    try:
        yield execution
    finally:
        _current_execution.reset(token)


def current_execution() -> Optional[CommandExecution]:
    return _current_execution.get()


def defer_current_command_completion() -> Optional[int]:
    """Keep the running command ``PROCESSING`` after the transition commits.

    Returns the command instance id the caller must link to its outbox event,
    or ``None`` when the transition does not run inside a worker instance
    (for example a direct engine call in a test or maintenance script).
    """

    execution = _current_execution.get()
    if execution is None:
        return None
    execution.deferred = True
    return execution.instance_id
