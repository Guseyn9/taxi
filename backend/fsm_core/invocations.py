"""Core-first transition coordination. All methods use the caller's transaction."""
from sqlalchemy import text

from .command_completion import current_execution, defer_current_command_completion
from .command_idempotency import update_command_status
from .errors import EntitySyncInProgress, AuthenticationError
from .serialization import json_dumps
from .types import FsmResult, Trigger


def assert_entity_unlocked(session, service, entity_type, entity_id, *, allowed_event=None):
    params = dict(service=service, entity_type=entity_type, entity_id=entity_id)
    row = session.execute(text("SELECT outbox_event_id FROM fsm_entity_locks WHERE service=:service AND entity_type=:entity_type AND entity_id=:entity_id FOR UPDATE"), params).fetchone()
    if (row and row[0] != allowed_event) or (allowed_event is not None and row is None):
        raise EntitySyncInProgress("ENTITY_SYNC_IN_PROGRESS")
    mismatch = session.execute(text("SELECT id FROM fsm_sync_mismatches WHERE service=:service AND entity_type=:entity_type AND entity_id=:entity_id AND resolved_at IS NULL LIMIT 1"), params).fetchone()
    if mismatch:
        raise EntitySyncInProgress("ENTITY_RECONCILIATION_REQUIRED")


def stage_invocation(session, registry, *, service, process_name, entity_type, entity_id, trigger, user_id, context, transition):
    binding = session.execute(text("""SELECT i.handler_name, i.request_builder, i.max_wait_seconds, i.on_error_trigger
        FROM fsm_transition_invocations i JOIN fsm_transitions t ON t.id=i.transition_id
        JOIN fsm_states s ON s.id=t.from_state_id JOIN fsm_actions a ON a.id=t.action_id
        WHERE t.service=:service AND t.entity_type=:entity_type AND s.name=:state AND a.name=:action"""),
        dict(service=service, entity_type=entity_type, state=context.status, action=transition.action_name)).fetchone()
    if binding is None:
        if any(item[:4] == (service,entity_type,context.status,transition.action_name) for item in registry.required_external_transitions):
            raise RuntimeError("Required Core-first transition binding is missing")
        return None
    execution = current_execution()
    if execution is None:
        raise AuthenticationError("External transitions require an authenticated durable command")
    credentials = session.execute(text("SELECT credentials_encrypted FROM fsm_command_credentials WHERE instance_id=:id"), {"id": execution.instance_id}).scalar()
    if not credentials:
        raise AuthenticationError("External command has no user credentials")
    from .core_client import CredentialCipher
    _, private_payload = CredentialCipher.from_env().decrypt_bundle(credentials)
    private_trigger = Trigger(trigger.trigger_type,trigger.trigger_name,dict(trigger.payload,**private_payload))
    request = registry.get_request_builder(binding[1])(session, context, private_trigger, transition.action_name, user_id)
    from .outbox import enqueue_outbox_event, OutboxCompletion
    event_id = enqueue_outbox_event(session, service=service, aggregate_type=entity_type, aggregate_id=entity_id,
        event_type=transition.action_name, handler_name=binding[0], payload=request,
        idempotency_key=f"fsm-invocation-{execution.instance_id}",
        completion=OutboxCompletion(process_name, "", "", execution.instance_id, invocation={
            "expectedState": context.status, "action": transition.action_name,
            "trigger": trigger.trigger_name, "payload": trigger.payload, "userId": user_id,
            "onErrorTrigger": binding[3],
        }))
    session.execute(text("UPDATE core_outbox SET credentials_encrypted=:credentials WHERE id=:id"), {"credentials": credentials, "id": event_id})
    session.execute(text("""INSERT INTO fsm_entity_locks(service,entity_type,entity_id,command_instance_id,outbox_event_id,action_name,expires_at)
        VALUES(:service,:entity_type,:entity_id,:command,:event,:action,TIMESTAMPADD(SECOND,:wait,CURRENT_TIMESTAMP))"""),
        dict(service=service, entity_type=entity_type, entity_id=entity_id, command=execution.instance_id, event=event_id, action=transition.action_name, wait=binding[2]))
    defer_current_command_completion()
    session.execute(text("DELETE FROM fsm_command_credentials WHERE instance_id=:id"), {"id": execution.instance_id})
    return FsmResult(True, transition.action_name, context.status, context.status, "Awaiting Core confirmation", "PROCESSING")


def record_mismatch(session, event, reason):
    session.execute(text("""INSERT INTO fsm_sync_mismatches(service,entity_type,entity_id,outbox_event_id,reason)
        VALUES(:service,:type,:id,:event,:reason) ON DUPLICATE KEY UPDATE reason=VALUES(reason)"""),
        dict(service=event.service, type=event.aggregate_type, id=event.aggregate_id, event=event.id, reason=reason))


def finalize_invocation(session, event, response, *, sent, error=None):
    """Atomic with outbox SENT/FAILED; no crash gap between delivery and transition."""
    from .types import Trigger
    from .transition_runner import TransitionRunner
    from .realtime import record_transition_event
    from fsm_worker import build_registry
    data = event.completion.invocation
    target = event.completion.command_instance_id
    code = "CORE_REJECTED"
    if sent:
        savepoint = session.begin_nested()
        try:
            registry = build_registry(external_sync=True)
            TransitionRunner(registry, transition_event_recorder=record_transition_event).run(
                session, service=event.service, process_name=event.completion.process_name,
                entity_type=event.aggregate_type, entity_id=event.aggregate_id,
                trigger=Trigger("command", data["trigger"], data["payload"]), user_id=data["userId"],
                invocation_event_id=event.id, expected_state=data["expectedState"],
                expected_action=data["action"], core_response=response)
            savepoint.commit()
        except Exception:
            savepoint.rollback()
            record_mismatch(session, event, "CORE_SUCCEEDED_FSM_REJECTED")
            sent, code = False, "CORE_FSM_DIVERGENCE"
    elif error in {"CORE_OUTCOME_UNKNOWN", "CORE_PROCESSING_LEASE_EXPIRED"}:
        record_mismatch(session, event, error)
        code = "CORE_OUTCOME_UNKNOWN"
    elif error in {"AUTHORIZATION_FAILED", "CORE_AUTHENTICATION_REQUIRED"}:
        code = error
    session.execute(text("DELETE FROM fsm_entity_locks WHERE outbox_event_id=:id"), {"id": event.id})
    session.execute(text("DELETE FROM fsm_command_credentials WHERE instance_id=:id"), {"id": target})
    update_command_status(session, target, "COMPLETED" if sent else "FAILED", error_code=None if sent else code,
        error_message=None if sent else code)
    if not sent and code not in {"CORE_FSM_DIVERGENCE","CORE_OUTCOME_UNKNOWN"} and data.get('onErrorTrigger'):
        from .workers import enqueue_fsm_instance
        enqueue_fsm_instance(session,service=event.service,process_name=event.completion.process_name,
            entity_type=event.aggregate_type,entity_id=event.aggregate_id,
            trigger=Trigger('event',data['onErrorTrigger'],{'outboxEventId':event.id,'errorCode':code}),
            user_id=0,user_role='system')


def sync_status(session, service, entity_type, entity_id):
    params = dict(service=service, type=entity_type, id=entity_id)
    row = session.execute(text("SELECT action_name,locked_at FROM fsm_entity_locks WHERE service=:service AND entity_type=:type AND entity_id=:id"), params).fetchone()
    if row:
        return {"status": "pending", "action": row[0], "since": row[1].isoformat()}
    mismatch = session.execute(text("SELECT reason FROM fsm_sync_mismatches WHERE service=:service AND entity_type=:type AND entity_id=:id AND resolved_at IS NULL LIMIT 1"), params).fetchone()
    return {"status": "error", "reason": mismatch[0]} if mismatch else {"status": "idle"}
