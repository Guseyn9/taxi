"""Generate the reviewed Taxi graph and Core bindings for migration 010."""
import json
from pathlib import Path
from domains.taxi.fsm_spec import ORDER_TRANSITIONS
from domains.taxi.invocations import ACTION_TO_CORE

def quote(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"

sql = '''-- Core-first Taxi graph. Stop all three FSM processes before migration.
-- Quarantine unfinished legacy cancellation deliveries before removing their
-- confirm/revert graph. All old workers must be stopped before this migration.
INSERT INTO fsm_sync_mismatches(service,entity_type,entity_id,outbox_event_id,reason)
 SELECT o.service,o.aggregate_type,o.aggregate_id,o.id,'LEGACY_DRIVER_CANCEL_OUTCOME_REQUIRES_RECONCILIATION'
 FROM core_outbox o JOIN fsm_command_idempotency c
 ON c.instance_id=CAST(JSON_UNQUOTE(JSON_EXTRACT(o.completion_json,'$.commandInstanceId')) AS UNSIGNED)
 WHERE o.handler_name='core_http' AND JSON_UNQUOTE(JSON_EXTRACT(o.completion_json,'$.onSentTrigger'))='driver_cancel_confirmed'
 AND c.status IN ('PENDING','PROCESSING')
 ON DUPLICATE KEY UPDATE reason=VALUES(reason);
UPDATE core_outbox o JOIN fsm_sync_mismatches m ON m.outbox_event_id=o.id
 SET o.status='FAILED',o.credentials_encrypted=NULL,o.locked_at=NULL,o.locked_by=NULL,o.last_error='Legacy delivery quarantined at Core-first cutover'
 WHERE m.reason='LEGACY_DRIVER_CANCEL_OUTCOME_REQUIRES_RECONCILIATION' AND o.status IN ('PENDING','PROCESSING','RETRY');
UPDATE fsm_command_idempotency c JOIN core_outbox o
 ON c.instance_id=CAST(JSON_UNQUOTE(JSON_EXTRACT(o.completion_json,'$.commandInstanceId')) AS UNSIGNED)
 JOIN fsm_sync_mismatches m ON m.outbox_event_id=o.id
 SET c.status='FAILED',c.response_json=JSON_SET(c.response_json,'$.errorCode','CORE_OUTCOME_UNKNOWN','$.errorMessage','Legacy delivery requires reconciliation')
 WHERE m.reason='LEGACY_DRIVER_CANCEL_OUTCOME_REQUIRES_RECONCILIATION' AND c.status IN ('PENDING','PROCESSING');
UPDATE server_fsm_instances SET instance_status='FAILED',last_error='Legacy cancellation follow-up retired'
 WHERE service='taxi' AND trigger_name IN ('driver_cancel_confirmed','driver_cancel_failed') AND instance_status IN ('PENDING','PROCESSING');
-- Restore old pending cancellations before removing the obsolete graph.
UPDATE orders SET status=JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.driver_cancel.previous_state'))
WHERE status='order_driver_cancel_pending' AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.driver_cancel.previous_state'))
 IN ('order_driver_assigned','order_vote_driver_assigned','order_driver_arrived');
-- Unrecognised legacy pending rows remain quarantined; do not guess their state.
INSERT INTO fsm_sync_mismatches(service,entity_type,entity_id,reason)
 SELECT 'taxi','order',id,'LEGACY_CANCEL_NEEDS_RECONCILIATION' FROM orders o WHERE status='order_driver_cancel_pending'
 AND NOT EXISTS(SELECT 1 FROM fsm_sync_mismatches m WHERE m.service='taxi' AND m.entity_type='order' AND m.entity_id=o.id AND m.resolved_at IS NULL);
DELETE i FROM fsm_transition_invocations i JOIN fsm_transitions t ON t.id=i.transition_id WHERE t.service='taxi' AND t.entity_type='order';
DELETE FROM fsm_transitions WHERE service='taxi' AND entity_type='order';
'''
for item in ORDER_TRANSITIONS:
    for table, name in [('fsm_states', item.from_state), ('fsm_states', item.to_state), ('fsm_actions', item.action)]:
        sql += f'INSERT IGNORE INTO {table}(name,label) VALUES({quote(name)},{quote(name)});\n'
    values=[item.guard_name, json.dumps(item.guard_params) if item.guard_params else None, item.effect_name, json.dumps(item.effect_params) if item.effect_params else None]
    sql += f'''INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,{','.join(map(quote, values))} FROM fsm_states s JOIN fsm_actions a ON a.name={quote(item.action)} JOIN fsm_states d ON d.name={quote(item.to_state)} WHERE s.name={quote(item.from_state)};
'''
    if item.action in ACTION_TO_CORE:
        sql += "INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');\n"
Path(__file__).resolve().parents[1].joinpath('fsm_core/sql/010_taxi_core_first.sql').write_text(sql)
