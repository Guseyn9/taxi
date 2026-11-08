"""Authenticated Command API service: intent → enqueue → worker.

Single source of truth for command lifecycle on top of
``fsm_command_idempotency``. Worker and HTTP API call into this service; they
do not write SQL against the idempotency table directly.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Dict, Mapping, Optional, Protocol

from sqlalchemy.orm import Session
from sqlalchemy import text

from .command_idempotency import (
    ALLOWED_STATUSES,
    FAILED,
    PENDING,
    TERMINAL_STATUSES,
    CommandStatusError,
    get_command_by_instance_id,
    get_command_idempotency,
    get_command_idempotency_unfiltered,
    put_command_idempotency,
    update_command_status,
)
from .errors import AuthorizationError, CommandNotFoundError
from .security import Principal
from .snapshots import ReadOnlySession, SnapshotService
from .types import Trigger
from .workers import enqueue_fsm_instance

COMMAND_SCHEMA_VERSION = "1.0"


def public_command_payload(payload):
    return {key:value for key,value in payload.items() if key not in {'boardingCode','pin'}}


class IntentDefinition(Protocol):
    @property
    def intent(self) -> str: ...

    @property
    def process_name(self) -> str: ...

    @property
    def trigger_name(self) -> str: ...

    @property
    def trigger_type(self) -> str: ...

    @property
    def allowed_roles(self) -> frozenset[str]: ...


class IntentCatalog(Protocol):
    def resolve(self, *, service: str, entity_type: str, intent: str) -> IntentDefinition:
        ...


@dataclass(frozen=True)
class CommandEnvelope:
    schema_version: str
    intent: str
    payload: Dict[str, Any]
    command_id: Optional[str] = None
    correlation_id: Optional[str] = None
    causation_id: Optional[str] = None
    idempotency_key: Optional[str] = None


@dataclass(frozen=True)
class CommandAcceptResult:
    response: Dict[str, Any]
    duplicate: bool


class CommandValidationError(ValueError):
    """Client sent an invalid command envelope or intent."""


def parse_command_envelope(
    body: Mapping[str, Any],
    *,
    idempotency_header: Optional[str] = None,
) -> CommandEnvelope:
    if not isinstance(body, Mapping):
        raise CommandValidationError("Command body must be a JSON object")

    schema_version = str(body.get("schemaVersion") or COMMAND_SCHEMA_VERSION).strip()
    if schema_version != COMMAND_SCHEMA_VERSION:
        raise CommandValidationError(
            f"Unsupported schemaVersion: {schema_version}; expected {COMMAND_SCHEMA_VERSION}"
        )

    intent = body.get("intent") or body.get("triggerName")
    if not isinstance(intent, str) or not intent.strip():
        raise CommandValidationError("intent is required")

    payload = body.get("payload") or {}
    if not isinstance(payload, Mapping):
        raise CommandValidationError("payload must be an object")
    def validate_public(value, depth=0):
        if depth > 20:
            raise CommandValidationError("Command payload is too deeply nested")
        if isinstance(value, Mapping):
            for key, item in value.items():
                if str(key).lower().replace('-', '').replace('_','') in {"token", "uhash", "credentials", "authorization", "credentialsencrypted", "xauthtoken", "xauthuhash"}:
                    raise CommandValidationError("Credentials belong in authentication headers only")
                validate_public(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                validate_public(item, depth + 1)
    validate_public(payload)

    command_id = _optional_str(body.get("commandId"))
    correlation_id = _optional_str(body.get("correlationId"))
    causation_id = _optional_str(body.get("causationId"))
    idempotency_key = (
        _optional_str(idempotency_header)
        or _optional_str(body.get("idempotencyKey"))
        or command_id
    )
    if not idempotency_key:
        raise CommandValidationError(
            "idempotencyKey is required (header Idempotency-Key, body.idempotencyKey, or body.commandId)"
        )
    if any(value and len(value) > 128 for value in (idempotency_key, command_id, correlation_id, causation_id)):
        raise CommandValidationError("Command identifiers must not exceed 128 characters")
    if len(json.dumps(payload)) > 64000:
        raise CommandValidationError("Command payload exceeds size limit")

    return CommandEnvelope(
        schema_version=schema_version,
        intent=intent.strip(),
        payload=dict(payload),
        command_id=command_id,
        correlation_id=correlation_id,
        causation_id=causation_id,
        idempotency_key=idempotency_key,
    )


def _optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


class CommandService:
    """Accept external intents, append worker tasks, and expose command status.

    The service owns no Session: callers (HTTP adapter, worker) pass their own
    Session in and decide whether to commit or roll back.

    Status transitions on ``fsm_command_idempotency`` go exclusively through
    :func:`fsm_core.command_idempotency.update_command_status`, which enforces
    the runtime state machine (``ALLOWED_TRANSITIONS``), terminal-state
    immutability, and persists ``errorCode`` inside ``response_json``.

    .. warning:: Transaction boundary contract for ``accept()``

        ``accept()`` performs two writes in sequence against the caller's
        Session:

        1. ``enqueue_fsm_instance`` — inserts a row into
           ``server_fsm_instances`` (the worker execution queue).
        2. ``put_command_idempotency`` — inserts a row into
           ``fsm_command_idempotency`` (the deduplication + status table).

        If two concurrent requests arrive with the same ``Idempotency-Key``,
        both will enqueue a worker instance, but only one will win the
        ``INSERT IGNORE`` on the idempotency table. The loser's worker
        instance becomes an **orphan** — it is only harmless if the caller's
        transaction is rolled back in the duplicate path, which the HTTP
        adapter does:

        .. code-block:: python

            if result.duplicate:
                session.rollback()
            else:
                session.commit()

        **Architectural constraint:** callers of ``accept()`` must NOT commit
        between the enqueue and the idempotency claim. The two writes must
        live in the same transaction so that a lost race rolls back the
        orphan enqueue. Splitting them into separate transactions would leak
        orphan rows into ``server_fsm_instances`` that the worker would then
        try to execute — producing a second execution for what the client
        sees as a single command.

        This is not a property of ``CommandService`` in isolation; it is a
        contract on how the caller manages the transaction boundary.
    """

    def __init__(
        self,
        snapshot_service: SnapshotService,
        catalogs: Mapping[str, IntentCatalog],
        *,
        idempotency_ttl_hours: int = 24,
    ):
        if not catalogs:
            raise ValueError("At least one IntentCatalog is required")
        self.snapshot_service = snapshot_service
        self.catalogs = dict(catalogs)
        self.idempotency_ttl_hours = idempotency_ttl_hours

    # ------------------------------------------------------------------ accept

    def accept(
        self,
        session: Session,
        *,
        principal: Principal,
        service: str,
        entity_type: str,
        entity_id: int,
        envelope: CommandEnvelope,
    ) -> CommandAcceptResult:
        catalog = self.catalogs.get(service)
        if catalog is None:
            raise CommandValidationError(f"Unsupported service: {service}")

        try:
            resolved = catalog.resolve(
                service=service,
                entity_type=entity_type,
                intent=envelope.intent,
            )
        except ValueError as exc:
            raise CommandValidationError(str(exc)) from exc

        if resolved.allowed_roles and not principal.has_role(*resolved.allowed_roles):
            raise AuthorizationError(
                f"Role cannot execute intent {resolved.intent} on {service}/{entity_type}/{entity_id}"
            )

        existing = get_command_idempotency(
            session,
            service=service,
            key=envelope.idempotency_key or "",
        )
        if existing is None:
            # ``get_command_idempotency`` filters by ``expires_at``. If the
            # record exists but has expired, the lookup returns None and we
            # would fall through to creating a brand-new execution — which
            # would silently reuse the same Idempotency-Key for a different
            # execution, breaking the deduplication contract. Detect this
            # case explicitly by re-reading without the retention filter and
            # surface it as 404, matching the GET endpoint's behaviour.
            unfiltered = get_command_idempotency_unfiltered(
                session,
                service=service,
                key=envelope.idempotency_key or "",
            )
            if unfiltered is not None:
                # Record exists but has expired. Treat the duplicate POST as
                # 404 — matches the GET endpoint's retention enforcement and
                # the README contract.
                raise CommandNotFoundError(
                    f"Command with idempotency key "
                    f"{envelope.idempotency_key!r} has expired and is no "
                    f"longer available"
                )
        else:
            previous = existing.get("response") or {}
            if previous.get("requestedByUserId") != principal.user_id or previous.get("entityId") != entity_id or previous.get("intent") != resolved.intent:
                raise AuthorizationError("Idempotency key belongs to a different command")
            if self.snapshot_service.registry.external_sync_enabled:
                from .serialization import json_loads_object
                stored = session.execute(text("SELECT metadata_json FROM server_fsm_instances WHERE id=:id"), {"id": existing["instance_id"]}).scalar()
                digest = json_loads_object(stored).get("requestDigest")
                requested = hashlib.sha256(json.dumps(public_command_payload(envelope.payload), sort_keys=True).encode()).hexdigest()
                if digest and digest != requested:
                    raise CommandValidationError("Idempotency key was used with a different payload")
            duplicate_response = self._build_duplicate_response(session, existing)
            if duplicate_response is None:
                # The existing record has expired between the lookup and the
                # current-status re-read (race). Treat as 404.
                raise CommandNotFoundError(
                    f"Command with idempotency key "
                    f"{envelope.idempotency_key!r} has expired and is no "
                    f"longer available"
                )
            return CommandAcceptResult(
                response=duplicate_response,
                duplicate=True,
            )

        if self.snapshot_service.registry.external_sync_enabled:
            access = self.snapshot_service.registry.get_access_policy(service, entity_type)
            if not access(ReadOnlySession(session), principal=principal, entity_type=entity_type, entity_id=entity_id):
                raise AuthorizationError("Access denied to command entity")
        else:
            self.snapshot_service.authorize(principal=principal, service=service, entity_type=entity_type, entity_id=entity_id)

        # Optional intent-level rule of the domain, e.g. "only the assigned
        # driver". Rejected before enqueue, so the client gets 403 and no
        # instance is created.
        command_policy = self.snapshot_service.registry.get_command_policy(service, entity_type)
        if command_policy is not None and not command_policy(
            ReadOnlySession(session),
            principal=principal,
            entity_type=entity_type,
            entity_id=entity_id,
            intent=resolved.intent,
        ):
            raise AuthorizationError(
                f"Principal {principal.user_id} cannot execute intent {resolved.intent} "
                f"on {service}/{entity_type}/{entity_id}"
            )

        if self.snapshot_service.registry.external_sync_enabled:
            from .invocations import assert_entity_unlocked
            from .core_client import CredentialCipher
            if principal.credentials is None:
                raise CommandValidationError("A user token/u_hash pair is required")
            # Serialize accepts with the worker using the same entity-row lock.
            process = self.snapshot_service.registry.get_process(service, resolved.process_name)
            context = process.context_builder(session, entity_type=entity_type, entity_id=entity_id)
            assert_entity_unlocked(session, service, entity_type, entity_id)
            if service == "taxi":
                from domains.taxi.invocations import validate_command_payload
                try:
                    validate_command_payload(context, resolved.intent, envelope.payload)
                except ValueError as exc:
                    raise CommandValidationError(str(exc)) from exc

        metadata = {
            "schemaVersion": envelope.schema_version,
            "commandId": envelope.command_id,
            "correlationId": envelope.correlation_id,
            "causationId": envelope.causation_id,
            "idempotencyKey": envelope.idempotency_key,
            "intent": resolved.intent,
            # Persist the entity this command targets so the GET endpoint can
            # re-run the snapshot access policy on each status request.
            "service": service,
            "entityType": entity_type,
            "entityId": entity_id,
            "requestedByUserId": principal.user_id,
            "requestDigest": hashlib.sha256(json.dumps(public_command_payload(envelope.payload), sort_keys=True).encode()).hexdigest(),
        }
        instance_id = enqueue_fsm_instance(
            session,
            service=service,
            process_name=resolved.process_name,
            entity_type=entity_type,
            entity_id=entity_id,
            trigger=Trigger(
                trigger_type=resolved.trigger_type,
                trigger_name=resolved.trigger_name,
                payload=public_command_payload(envelope.payload) if self.snapshot_service.registry.external_sync_enabled else envelope.payload,
            ),
            user_id=principal.user_id,
            user_role=principal.primary_role,
            metadata={key: value for key, value in metadata.items() if value is not None},
        )
        if instance_id <= 0:
            raise RuntimeError("Failed to enqueue command instance")
        if self.snapshot_service.registry.external_sync_enabled:
            private_payload = {key:value for key,value in envelope.payload.items() if key in {'boardingCode','pin'}}
            encrypted = CredentialCipher.from_env().encrypt(principal.credentials,private_payload=private_payload)
            session.execute(text("INSERT INTO fsm_command_credentials(instance_id,credentials_encrypted) VALUES(:id,:value)"), {"id": instance_id, "value": encrypted})

        response = {
            "schemaVersion": envelope.schema_version,
            "accepted": True,
            "duplicate": False,
            "instanceId": instance_id,
            "status": PENDING,
            "commandId": envelope.command_id,
            "correlationId": envelope.correlation_id,
            "causationId": envelope.causation_id,
            "idempotencyKey": envelope.idempotency_key,
            "service": service,
            "entityType": entity_type,
            "entityId": entity_id,
            "intent": resolved.intent,
            "triggerName": resolved.trigger_name,
            "processName": resolved.process_name,
            "requestedByUserId": principal.user_id,
        }
        inserted = put_command_idempotency(
            session,
            service=service,
            key=envelope.idempotency_key or "",
            response=response,
            instance_id=instance_id,
            ttl_hours=self.idempotency_ttl_hours,
            status=PENDING,
        )
        if not inserted:
            # Race condition: another request inserted the same
            # (service, scope, idempotency_key) between our lookup and our
            # INSERT IGNORE. The two requests may even have produced two
            # different instance_ids (the winner is whoever committed first;
            # the loser's enqueue_fsm_instance row is orphaned but harmless —
            # the worker will pick it up and try to execute it, but the
            # idempotency key is what the client uses to deduplicate).
            #
            # Critical: the duplicate response must reflect the *current*
            # status of the winner's instance_id, not the PENDING captured at
            # POST time. By the time we lose the race the worker may have
            # already advanced the execution to PROCESSING or even COMPLETED.
            again = get_command_idempotency(
                session,
                service=service,
                key=envelope.idempotency_key or "",
            )
            if again and isinstance(again.get("response"), dict):
                previous = again['response']
                if previous.get('requestedByUserId') != principal.user_id or previous.get('entityId') != entity_id or previous.get('intent') != resolved.intent:
                    raise AuthorizationError('Idempotency key belongs to a different command')
                if self.snapshot_service.registry.external_sync_enabled:
                    from .serialization import json_loads_object
                    stored = session.execute(text("SELECT metadata_json FROM server_fsm_instances WHERE id=:id"), {"id": again["instance_id"]}).scalar()
                    digest = json_loads_object(stored).get("requestDigest")
                    requested = hashlib.sha256(json.dumps(public_command_payload(envelope.payload), sort_keys=True).encode()).hexdigest()
                    if digest and digest != requested:
                        raise CommandValidationError("Idempotency key was used with a different payload")
                duplicate_response = self._build_duplicate_response(session, again)
                if duplicate_response is None:
                    # Race-loser path: the winner's record has expired between
                    # our INSERT IGNORE and this re-read. Treat as 404.
                    raise CommandNotFoundError(
                        f"Command with idempotency key "
                        f"{envelope.idempotency_key!r} has expired and is no "
                        f"longer available"
                    )
                return CommandAcceptResult(
                    response=duplicate_response,
                    duplicate=True,
                )
            raise RuntimeError("Command idempotency race unresolved")

        return CommandAcceptResult(response=response, duplicate=False)

    # --------------------------------------------------------- status queries

    @staticmethod
    def _build_duplicate_response(
        session: Session,
        existing: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Build a duplicate-POST response that reflects the *current* status.

        ``response_json`` was captured at POST time and is immutable
        afterwards; the live status lives in the ``status`` column and is
        advanced by the worker (PENDING → PROCESSING → COMPLETED | FAILED).
        We lift the current status (and for FAILED also the errorCode /
        errorMessage) onto the duplicate response so a client retrying the
        same Idempotency-Key sees the real execution state — not the stale
        PENDING captured at POST #1 time.

        Returns ``None`` when the record has expired (``expires_at`` in the
        past). The caller (``accept``) treats this as "record no longer
        exists" and raises ``CommandNotFoundError``, so a duplicate POST for
        an expired execution returns 404 — matching the GET endpoint's
        behaviour and the README contract: "Запрос статуса после истечения
        retention возвращает 404." Without this check a duplicate POST for
        an expired record would silently return the stale PENDING captured
        at POST #1 time, which contradicts the retention contract.

        Used by both the regular duplicate path and the race-condition path
        (when ``INSERT IGNORE`` returns ``rowcount=0`` because a concurrent
        request won the race). Both paths must produce identical duplicate
        semantics — that is the whole point of an Idempotency API.
        """

        response = dict(existing.get("response") or {})
        response["duplicate"] = True

        instance_id = existing.get("instance_id")
        if instance_id is None:
            # Legacy record without instance_id — cannot look up the current
            # status. This is a data-integrity issue: every record created by
            # ``put_command_idempotency`` has ``instance_id`` set. Treat as
            # "record not usable" and return None so the caller raises 404,
            # rather than silently returning a stale response with no lifted
            # status.
            return None

        current = get_command_by_instance_id(session, int(instance_id))
        if current is None:
            # Record expired (or missing). Returning None signals to
            # ``accept`` that the duplicate POST must be treated as 404,
            # matching the GET endpoint's retention enforcement.
            return None

        current_status = current.get("status")
        if not current_status:
            # NULL status — data corruption (column has DEFAULT 'PENDING').
            # Treat as "record not usable" rather than fabricating a status.
            return None

        response["status"] = current_status
        if current_status == FAILED:
            current_response = current.get("response") or {}
            if current_response.get("errorCode"):
                response["errorCode"] = current_response["errorCode"]
            if current_response.get("errorMessage"):
                response["errorMessage"] = current_response["errorMessage"]

        return response

    def get_command_status(
        self,
        session: Session,
        instance_id: int,
        *,
        principal: Optional[Principal] = None,
    ) -> Optional[Dict[str, Any]]:
        """Return the public status payload for one execution.

        Returns ``None`` when ``instance_id`` is unknown **or** when the
        record's ``status`` column is NULL — a NULL status indicates data
        corruption (the column has ``DEFAULT 'PENDING'`` and is never set
        to NULL by any code path), so we treat it as "record not found"
        and the HTTP layer returns 404 rather than silently fabricating a
        PENDING status.

        The public payload always contains:

        * ``instanceId`` — integer;
        * ``status`` — one of ``PENDING``/``PROCESSING``/``COMPLETED``/``FAILED``;
        * ``errorCode`` — only for ``FAILED`` (machine-readable code).

        The full response envelope (``commandId``, ``correlationId``,
        ``idempotencyKey``, …) is also returned so Platform Channel can match
        the execution against the original POST response.
        """

        record = get_command_by_instance_id(session, instance_id)
        if record is None:
            return None

        status = record.get("status")
        if status is None:
            # NULL status is unexpected — the column has DEFAULT 'PENDING'
            # and update_command_status never sets it to NULL. Treat as
            # "record not found" (→ 404) rather than silently substituting
            # PENDING, which would mask a data-corruption bug.
            return None

        response = dict(record.get("response") or {})

        if principal is not None:
            self._authorize_status_read(session, principal=principal, response=response)

        payload: Dict[str, Any] = {
            "instanceId": instance_id,
            "status": status,
            "commandId": response.get("commandId"),
            "correlationId": response.get("correlationId"),
            "causationId": response.get("causationId"),
            "idempotencyKey": response.get("idempotencyKey"),
            "service": response.get("service"),
            "entityType": response.get("entityType"),
            "entityId": response.get("entityId"),
            "intent": response.get("intent"),
            "duplicate": response.get("duplicate", False),
        }

        if status == FAILED:
            error_code = response.get("errorCode") or "INTERNAL_ERROR"
            payload["errorCode"] = error_code
            error_message = response.get("errorMessage")
            if error_message:
                payload["errorMessage"] = error_message

        return payload

    # ------------------------------------------------------- status mutations

    def update_command_status(
        self,
        session: Session,
        instance_id: int,
        status: str,
        *,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> bool:
        """Transition the status of one execution.

        Delegates to :func:`fsm_core.command_idempotency.update_command_status`,
        which validates the status, enforces terminal immutability and persists
        ``errorCode`` inside ``response_json``.
        """

        return update_command_status(
            session,
            instance_id,
            status,
            error_code=error_code,
            error_message=error_message,
        )

    # -------------------------------------------------------------- internals

    def _authorize_status_read(
        self,
        session: Session,
        *,
        principal: Principal,
        response: Dict[str, Any],
    ) -> None:
        """Reuse the snapshot access policy to authorize a status read.

        Order of checks:

        1. admin/system bypass;
        2. original requester (``requestedByUserId`` == principal.user_id);
        3. snapshot access policy on the recorded entity;
        4. deny.

        The owner check (2) runs *before* the snapshot access policy so that a
        principal who created the command but no longer has access to the
        entity (e.g. order moved to a different driver) can still read the
        execution result. Without this, a FAILED result could become
        invisible to the user who triggered it.
        """

        if principal.has_role("admin", "system"):
            return

        requested_by = response.get("requestedByUserId")
        if requested_by is not None and int(requested_by) == principal.user_id:
            return

        service = response.get("service")
        entity_type = response.get("entityType")
        entity_id_raw = response.get("entityId")

        if service and entity_type and entity_id_raw is not None:
            try:
                entity_id = int(entity_id_raw)
            except (TypeError, ValueError):
                raise AuthorizationError(
                    "Command execution references invalid entity identifier"
                )
            self.snapshot_service.authorize(
                principal=principal,
                service=str(service),
                entity_type=str(entity_type),
                entity_id=entity_id,
            )
            return

        # Legacy row without entity metadata: only the original requester (or
        # admin/system) may read it.
        raise AuthorizationError(
            f"Principal {principal.user_id} is not authorized to read command execution"
        )


# Public re-exports for callers that import from command_service.
__all__ = [
    "COMMAND_SCHEMA_VERSION",
    "ALLOWED_STATUSES",
    "TERMINAL_STATUSES",
    "CommandAcceptResult",
    "CommandEnvelope",
    "CommandService",
    "CommandStatusError",
    "CommandValidationError",
    "parse_command_envelope",
]
