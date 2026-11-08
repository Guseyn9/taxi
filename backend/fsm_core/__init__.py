"""Reusable Python runtime for table-driven FSM processes."""

from .command_api import create_command_router
from .command_service import (
    COMMAND_SCHEMA_VERSION,
    CommandAcceptResult,
    CommandEnvelope,
    CommandService,
    CommandValidationError,
    parse_command_envelope,
)
from .command_completion import defer_current_command_completion
from .engine import FsmEngine
from .outbox import (
    DeliveryResult,
    HttpJsonOutboxHandler,
    OutboxCompletion,
    OutboxDispatcher,
    OutboxEvent,
    OutboxHandlerRegistry,
    enqueue_outbox_event,
)
from .outbox_service import OutboxService
from .errors import FsmError
from .realtime import (
    InMemoryRealtimeHub,
    RedisRealtimeHub,
    RealtimeEvent,
    RealtimeHub,
    RealtimePublisher,
    RealtimeTransport,
)
from .registry import FsmRegistry, RegistryValidationError, RegistryValidationReport
from .security import ApiKeyPrincipalProvider, Principal, ScopePrincipalProvider
from .snapshots import SnapshotService
from .types import EffectResult, FsmResult, GuardResult, ProcessDef, TransitionDef, Trigger
from .worker_service import FsmWorkerService
from .workers import (
    FsmInstanceWorker,
    WorkerBatchResult,
    WorkerItemResult,
    enqueue_fsm_instance,
    enqueue_instance_trigger,
)

__all__ = [
    "COMMAND_SCHEMA_VERSION",
    "CommandAcceptResult",
    "CommandEnvelope",
    "CommandService",
    "CommandValidationError",
    "EffectResult",
    "DeliveryResult",
    "FsmEngine",
    "FsmError",
    "FsmInstanceWorker",
    "FsmRegistry",
    "FsmResult",
    "FsmWorkerService",
    "GuardResult",
    "ProcessDef",
    "HttpJsonOutboxHandler",
    "OutboxCompletion",
    "OutboxDispatcher",
    "OutboxEvent",
    "OutboxHandlerRegistry",
    "OutboxService",
    "create_command_router",
    "defer_current_command_completion",
    "enqueue_outbox_event",
    "parse_command_envelope",
    "RealtimeEvent",
    "RealtimeHub",
    "RealtimeTransport",
    "InMemoryRealtimeHub",
    "RedisRealtimeHub",
    "RealtimePublisher",
    "Principal",
    "ApiKeyPrincipalProvider",
    "ScopePrincipalProvider",
    "SnapshotService",
    "RegistryValidationError",
    "RegistryValidationReport",
    "TransitionDef",
    "Trigger",
    "WorkerBatchResult",
    "WorkerItemResult",
    "enqueue_fsm_instance",
    "enqueue_instance_trigger",
]
