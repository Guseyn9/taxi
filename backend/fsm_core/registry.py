"""Registries and startup validation for FSM Platform components."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from .errors import FsmError
from .security import CommandPolicy, EntityAccessPolicy
from .types import EffectFn, GuardFn, ProcessDef, SnapshotBuilder


class RegistryError(FsmError):
    pass


class RegistryValidationError(RegistryError):
    pass


@dataclass(frozen=True)
class RegistryValidationReport:
    checked_transitions: int
    checked_instances: int


class FsmRegistry:
    def __init__(self) -> None:
        self._processes: Dict[Tuple[str, str], ProcessDef] = {}
        self._guards: Dict[str, GuardFn] = {}
        self._effects: Dict[str, EffectFn] = {}
        self._snapshot_builders: Dict[Tuple[str, str], SnapshotBuilder] = {}
        self._access_policies: Dict[Tuple[str, str], EntityAccessPolicy] = {}
        self._command_policies: Dict[Tuple[str, str], CommandPolicy] = {}
        self.external_sync_enabled = False
        self._request_builders = {}
        self.required_external_transitions = set()

    def register_request_builder(self, name, builder):
        if name in self._request_builders:
            raise RegistryError(f"Request builder already registered: {name}")
        self._request_builders[name] = builder

    def get_request_builder(self, name):
        try:
            return self._request_builders[name]
        except KeyError:
            raise RegistryError(f"Unknown request builder: {name}") from None

    def register_process(self, process: ProcessDef) -> None:
        if bool(process.initial_action) == bool(process.action_resolver):
            raise RegistryError(
                f"Process {process.service}/{process.process_name} must define "
                "exactly one of initial_action or action_resolver"
            )
        key = (process.service, process.process_name)
        if key in self._processes:
            raise RegistryError(f"Process already registered: {process.service}/{process.process_name}")
        self._processes[key] = process

    def get_process(self, service: str, process_name: str) -> ProcessDef:
        try:
            return self._processes[(service, process_name)]
        except KeyError as exc:
            raise RegistryError(f"Unknown process: {service}/{process_name}") from exc

    def register_guard(self, name: str, guard: GuardFn) -> None:
        if name in self._guards:
            raise RegistryError(f"Guard already registered: {name}")
        self._guards[name] = guard

    def get_guard(self, name: str) -> GuardFn:
        try:
            return self._guards[name]
        except KeyError as exc:
            raise RegistryError(f"Unknown guard: {name}") from exc

    def register_effect(self, name: str, effect: EffectFn) -> None:
        if name in self._effects:
            raise RegistryError(f"Effect already registered: {name}")
        self._effects[name] = effect

    def get_effect(self, name: str) -> EffectFn:
        try:
            return self._effects[name]
        except KeyError as exc:
            raise RegistryError(f"Unknown effect: {name}") from exc

    def register_snapshot_builder(
        self,
        service: str,
        entity_type: str,
        builder: SnapshotBuilder,
    ) -> None:
        key = (service, entity_type)
        if key in self._snapshot_builders:
            raise RegistryError(f"Snapshot builder already registered: {service}/{entity_type}")
        self._snapshot_builders[key] = builder

    def get_snapshot_builder(self, service: str, entity_type: str) -> SnapshotBuilder:
        try:
            return self._snapshot_builders[(service, entity_type)]
        except KeyError as exc:
            raise RegistryError(f"Unknown snapshot builder: {service}/{entity_type}") from exc

    def register_access_policy(
        self,
        service: str,
        entity_type: str,
        policy: EntityAccessPolicy,
    ) -> None:
        key = (service, entity_type)
        if key in self._access_policies:
            raise RegistryError(f"Access policy already registered: {service}/{entity_type}")
        self._access_policies[key] = policy

    def get_access_policy(self, service: str, entity_type: str) -> EntityAccessPolicy:
        try:
            return self._access_policies[(service, entity_type)]
        except KeyError as exc:
            raise RegistryError(f"Unknown access policy: {service}/{entity_type}") from exc

    def register_command_policy(
        self,
        service: str,
        entity_type: str,
        policy: CommandPolicy,
    ) -> None:
        key = (service, entity_type)
        if key in self._command_policies:
            raise RegistryError(f"Command policy already registered: {service}/{entity_type}")
        self._command_policies[key] = policy

    def get_command_policy(self, service: str, entity_type: str) -> Optional[CommandPolicy]:
        """Command policies are optional; ``None`` means role + access policy only."""
        return self._command_policies.get((service, entity_type))

    def validate_database(self, session: Session) -> RegistryValidationReport:
        """Fail startup when SQL declarations cannot be executed by Registry."""

        errors: List[str] = []
        if self.external_sync_enabled:
            rows = session.execute(text("""SELECT t.service,t.entity_type,s.name,a.name,d.name,i.transition_id
                FROM fsm_transitions t JOIN fsm_states s ON s.id=t.from_state_id
                JOIN fsm_states d ON d.id=t.to_state_id JOIN fsm_actions a ON a.id=t.action_id
                LEFT JOIN fsm_transition_invocations i ON i.transition_id=t.id""")).fetchall()
            actual = {tuple(row[:5]) for row in rows if row[5] is not None}
            for required in sorted(self.required_external_transitions - actual):
                errors.append("missing Core-first binding: " + "/".join(required))
            for handler, builder in session.execute(text("SELECT DISTINCT handler_name, request_builder FROM fsm_transition_invocations")).fetchall():
                if handler != "ibronevik":
                    errors.append(f"unsupported invocation handler: {handler}")
                if builder not in self._request_builders:
                    errors.append(f"unregistered request builder: {builder}")
        transition_rows = session.execute(
            text(
                """
                SELECT DISTINCT t.guard_name, t.effect_name
                FROM fsm_transitions t
                WHERE t.guard_name IS NOT NULL OR t.effect_name IS NOT NULL
                """
            )
        ).fetchall()
        for guard_name, effect_name in transition_rows:
            if guard_name and str(guard_name) not in self._guards:
                errors.append(f"unregistered guard: {guard_name}")
            if effect_name and str(effect_name) not in self._effects:
                errors.append(f"unregistered effect: {effect_name}")

        duplicate_rows = session.execute(
            text(
                """
                SELECT COALESCE(t.service, '*'), COALESCE(t.entity_type, '*'),
                       fs.name, action.name, COUNT(*)
                FROM fsm_transitions t
                JOIN fsm_states fs ON fs.id = t.from_state_id
                JOIN fsm_actions action ON action.id = t.action_id
                GROUP BY t.service, t.entity_type, t.from_state_id, t.action_id
                HAVING COUNT(*) > 1
                """
            )
        ).fetchall()
        for service, entity_type, state, action, count in duplicate_rows:
            errors.append(
                f"ambiguous transition {service}/{entity_type}: "
                f"{state} + {action} ({count} rows)"
            )

        instance_rows = session.execute(
            text(
                """
                SELECT DISTINCT service, process_name
                FROM server_fsm_instances
                WHERE instance_status IN ('PENDING', 'PROCESSING', 'WAITING')
                  AND service IS NOT NULL
                """
            )
        ).fetchall()
        for service, process_name in instance_rows:
            if (str(service), str(process_name)) not in self._processes:
                errors.append(f"unregistered process: {service}/{process_name}")

        for process in self._processes.values():
            snapshot_key = (process.service, process.entity_type)
            if snapshot_key not in self._snapshot_builders:
                errors.append(
                    f"unregistered snapshot builder: {process.service}/{process.entity_type}"
                )
            if snapshot_key not in self._access_policies:
                errors.append(
                    f"unregistered access policy: {process.service}/{process.entity_type}"
                )

        if errors:
            raise RegistryValidationError("Registry validation failed: " + "; ".join(errors))

        return RegistryValidationReport(
            checked_transitions=len(transition_rows),
            checked_instances=len(instance_rows),
        )
