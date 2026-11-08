-- Core-first Taxi graph. Stop all three FSM processes before migration.
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
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_publish_vote','order_publish_vote');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_publish_vote' JOIN fsm_states d ON d.name='order_vote_waiting_candidates' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_select_candidate','order_select_candidate');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_select_candidate',NULL,'create_trip',NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_select_candidate' JOIN fsm_states d ON d.name='order_vote_driver_assigned' WHERE s.name='order_vote_waiting_candidates';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_release_candidate','order_release_candidate');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_release_candidate' JOIN fsm_states d ON d.name='order_vote_waiting_candidates' WHERE s.name='order_vote_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_no_show','order_vote_no_show');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_no_show','order_no_show');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_no_show' JOIN fsm_states d ON d.name='order_vote_no_show' WHERE s.name='order_vote_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_assign_direct','order_assign_direct');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,'create_trip',NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_assign_direct' JOIN fsm_states d ON d.name='order_driver_assigned' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_publish_offer','order_publish_offer');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_publish_offer' JOIN fsm_states d ON d.name='order_offer_waiting' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_select_offer','order_select_offer');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,'create_trip',NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_select_offer' JOIN fsm_states d ON d.name='order_driver_assigned' WHERE s.name='order_offer_waiting';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_arrive','order_arrive');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_arrive' JOIN fsm_states d ON d.name='order_driver_arrived' WHERE s.name='order_vote_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_arrive','order_arrive');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_arrive' JOIN fsm_states d ON d.name='order_driver_arrived' WHERE s.name='order_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_in_ride','order_in_ride');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_start','order_start');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_start_ride',NULL,'mark_trip_started',NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_start' JOIN fsm_states d ON d.name='order_in_ride' WHERE s.name='order_driver_arrived';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_in_ride','order_in_ride');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_completed','order_completed');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_finish','order_finish');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,'mark_trip_finished',NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_finish' JOIN fsm_states d ON d.name='order_completed' WHERE s.name='order_in_ride';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_vote_waiting_candidates';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_vote_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_driver_arrived';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_cancelled','order_cancelled');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_client','order_cancel_by_client');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_client' JOIN fsm_states d ON d.name='order_cancelled' WHERE s.name='order_offer_waiting';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_expired','order_expired');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_expire','order_expire');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_expire' JOIN fsm_states d ON d.name='order_expired' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_expired','order_expired');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_expire','order_expire');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_expire' JOIN fsm_states d ON d.name='order_expired' WHERE s.name='order_vote_waiting_candidates';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_expired','order_expired');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_expire','order_expire');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_expire' JOIN fsm_states d ON d.name='order_expired' WHERE s.name='order_offer_waiting';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_in_ride','order_in_ride');
INSERT IGNORE INTO fsm_states(name,label) VALUES('ride_interrupted','ride_interrupted');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_interrupt_ride','order_interrupt_ride');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_interrupt_ride' JOIN fsm_states d ON d.name='ride_interrupted' WHERE s.name='order_in_ride';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver','order_cancel_by_driver');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver' JOIN fsm_states d ON d.name='order_created' WHERE s.name='order_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver','order_cancel_by_driver');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver' JOIN fsm_states d ON d.name='order_created' WHERE s.name='order_driver_arrived';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_driver_assigned','order_vote_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver_vote','order_cancel_by_driver_vote');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver_vote' JOIN fsm_states d ON d.name='order_vote_waiting_candidates' WHERE s.name='order_vote_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_vote_waiting_candidates','order_vote_waiting_candidates');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver_vote','order_cancel_by_driver_vote');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver_vote' JOIN fsm_states d ON d.name='order_vote_waiting_candidates' WHERE s.name='order_driver_arrived';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_assigned','order_driver_assigned');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver_offer','order_cancel_by_driver_offer');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver_offer' JOIN fsm_states d ON d.name='order_offer_waiting' WHERE s.name='order_driver_assigned';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_driver_arrived','order_driver_arrived');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_cancel_by_driver_offer','order_cancel_by_driver_offer');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,'can_driver_cancel_order',NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_cancel_by_driver_offer' JOIN fsm_states d ON d.name='order_offer_waiting' WHERE s.name='order_driver_arrived';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_register','order_register');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_register' JOIN fsm_states d ON d.name='order_created' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_created','order_created');
INSERT IGNORE INTO fsm_states(name,label) VALUES('order_offer_waiting','order_offer_waiting');
INSERT IGNORE INTO fsm_actions(name,label) VALUES('order_register_offer','order_register_offer');
INSERT INTO fsm_transitions(service,entity_type,from_state_id,action_id,to_state_id,guard_name,guard_params,effect_name,effect_params)
SELECT 'taxi','order',s.id,a.id,d.id,NULL,NULL,NULL,NULL FROM fsm_states s JOIN fsm_actions a ON a.name='order_register_offer' JOIN fsm_states d ON d.name='order_offer_waiting' WHERE s.name='order_created';
INSERT INTO fsm_transition_invocations(transition_id,handler_name,request_builder) VALUES(LAST_INSERT_ID(),'ibronevik','taxi_core_request');
