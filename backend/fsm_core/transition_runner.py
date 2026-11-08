"""Common transition pipeline: context -> guard -> SQL Core -> effect."""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from fsm import call_fsm_action

from .errors import EffectFailed, GuardRejected, ProcessEntityMismatch
from .registry import FsmRegistry
from .repositories import TransitionRepository
from .types import (
    FsmResult,
    GuardResult,
    TransitionDef,
    TransitionEventRecorder,
    Trigger,
)


class TransitionRunner:
    def __init__(
        self,
        registry: FsmRegistry,
        *,
        transition_event_recorder: Optional[TransitionEventRecorder] = None,
        transition_repository: Optional[TransitionRepository] = None,
    ):
        self.registry = registry
        self.transition_event_recorder = transition_event_recorder
        self.transition_repository = transition_repository or TransitionRepository()

    def run(
        self,
        session: Session,
        *,
        service: str,
        process_name: str,
        entity_type: str,
        entity_id: int,
        trigger: Trigger,
        user_id: int,
        extra_id: Optional[str] = None,
        invocation_event_id=None,
        expected_state=None,
        expected_action=None,
        core_response=None,
    ) -> FsmResult:
        process = self.registry.get_process(service, process_name)
        if process.entity_type != entity_type:
            raise ProcessEntityMismatch(
                f"Process {service}/{process_name} expects {process.entity_type}, "
                f"got {entity_type}"
            )
        pre_context = process.context_builder(
            session,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        action_name = process.resolve_action(pre_context, trigger)
        current_state = getattr(pre_context, "status")
        if self.registry.external_sync_enabled:
            from .invocations import assert_entity_unlocked
            from .command_completion import current_execution
            from .security import Principal
            from .errors import AuthorizationError
            assert_entity_unlocked(session, service, entity_type, entity_id, allowed_event=invocation_event_id)
            if expected_state is not None and (current_state != expected_state or action_name != expected_action):
                raise GuardRejected("Core confirmation no longer matches the expected transition")
            execution = current_execution()
            principal = execution.principal if execution else None
            if invocation_event_id:
                role = session.execute(text("SELECT requested_user_role FROM server_fsm_instances WHERE id=(SELECT command_instance_id FROM fsm_entity_locks WHERE outbox_event_id=:id)"), {"id": invocation_event_id}).scalar()
                principal = Principal(user_id, (str(role),))
            policy = self.registry.get_command_policy(service, entity_type)
            if policy and (principal is None or not policy(session, principal=principal, entity_type=entity_type, entity_id=entity_id, intent=trigger.trigger_name)):
                raise AuthorizationError("Command initiator no longer has permission")
        transition = self.load_transition(
            session,
            service=service,
            entity_type=entity_type,
            from_state=current_state,
            action_name=action_name,
        )

        if transition.guard_name:
            guard = self.registry.get_guard(transition.guard_name)
            guard_result = guard(session, pre_context, transition.guard_params)
            if not guard_result.ok:
                raise GuardRejected(guard_result.reason or transition.guard_name)
        else:
            guard_result = GuardResult(ok=True)

        if self.registry.external_sync_enabled and invocation_event_id is None:
            from .invocations import stage_invocation
            staged = stage_invocation(session, self.registry, service=service, process_name=process_name,
                entity_type=entity_type, entity_id=entity_id, trigger=trigger, user_id=user_id,
                context=pre_context, transition=transition)
            if staged is not None:
                return staged

        if invocation_event_id and service == "taxi":
            from domains.taxi.invocations import apply_core_confirmation
            apply_core_confirmation(session, pre_context, trigger, action_name, core_response or {})

        procedure_result = call_fsm_action(
            session,
            entity_type=entity_type,
            entity_id=entity_id,
            action_name=action_name,
            user_id=user_id,
            extra_id=extra_id,
            expected_state=current_state,
            service=service,
        )

        if transition.effect_name:
            post_context = process.context_builder(
                session,
                entity_type=entity_type,
                entity_id=entity_id,
            )
            actual_state = getattr(post_context, "status")
            if actual_state != transition.to_state:
                raise EffectFailed(
                    f"Post-transition context has state {actual_state}, "
                    f"expected {transition.to_state}"
                )
            effect = self.registry.get_effect(transition.effect_name)
            effect_result = effect(session, post_context, transition.effect_params)
            if not effect_result.ok:
                raise EffectFailed(effect_result.message or transition.effect_name)

        if self.transition_event_recorder is not None:
            self.transition_event_recorder(
                session,
                service=service,
                entity_type=entity_type,
                entity_id=entity_id,
                transition=transition,
            )

        return FsmResult(
            ok=True,
            action_name=action_name,
            from_state=transition.from_state,
            to_state=transition.to_state,
            message=procedure_result.message,
            result_code=procedure_result.code,
        )

    def load_transition(
        self,
        session: Session,
        *,
        service: str,
        entity_type: str,
        from_state: str,
        action_name: str,
    ) -> TransitionDef:
        return self.transition_repository.get(
            session,
            service=service,
            entity_type=entity_type,
            from_state=from_state,
            action_name=action_name,
        )
