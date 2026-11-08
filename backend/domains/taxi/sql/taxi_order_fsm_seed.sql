-- Taxi order FSM seed for the existing table-driven MySQL engine.
-- The file is idempotent: it inserts only missing schema fields/names/transitions.
--
-- MySQL DDL causes implicit commits, so schema changes are intentionally placed
-- outside the data transaction. The DML seed below remains idempotent and can be
-- safely re-run if a later statement fails.

SET @server_fsm_instances_service_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'service'
);
SET @server_fsm_instances_service_sql := IF(
    @server_fsm_instances_service_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN service VARCHAR(50) NULL AFTER id',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_service FROM @server_fsm_instances_service_sql;
EXECUTE stmt_server_fsm_instances_service;
DEALLOCATE PREPARE stmt_server_fsm_instances_service;

SET @server_fsm_instances_status_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'instance_status'
);
SET @server_fsm_instances_status_sql := IF(
    @server_fsm_instances_status_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN instance_status VARCHAR(32) NOT NULL DEFAULT ''PENDING'' AFTER process_name',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_status FROM @server_fsm_instances_status_sql;
EXECUTE stmt_server_fsm_instances_status;
DEALLOCATE PREPARE stmt_server_fsm_instances_status;

SET @server_fsm_instances_trigger_type_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_type'
);
SET @server_fsm_instances_trigger_type_sql := IF(
    @server_fsm_instances_trigger_type_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_type VARCHAR(32) NULL AFTER instance_status',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_trigger_type FROM @server_fsm_instances_trigger_type_sql;
EXECUTE stmt_server_fsm_instances_trigger_type;
DEALLOCATE PREPARE stmt_server_fsm_instances_trigger_type;

SET @server_fsm_instances_trigger_name_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_name'
);
SET @server_fsm_instances_trigger_name_sql := IF(
    @server_fsm_instances_trigger_name_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_name VARCHAR(100) NULL AFTER trigger_type',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_trigger_name FROM @server_fsm_instances_trigger_name_sql;
EXECUTE stmt_server_fsm_instances_trigger_name;
DEALLOCATE PREPARE stmt_server_fsm_instances_trigger_name;

SET @server_fsm_instances_trigger_payload_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_payload'
);
SET @server_fsm_instances_trigger_payload_sql := IF(
    @server_fsm_instances_trigger_payload_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_payload JSON NULL AFTER trigger_name',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_trigger_payload FROM @server_fsm_instances_trigger_payload_sql;
EXECUTE stmt_server_fsm_instances_trigger_payload;
DEALLOCATE PREPARE stmt_server_fsm_instances_trigger_payload;

SET @server_fsm_instances_locked_at_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'locked_at'
);
SET @server_fsm_instances_locked_at_sql := IF(
    @server_fsm_instances_locked_at_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN locked_at DATETIME NULL AFTER next_timer_at',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_locked_at FROM @server_fsm_instances_locked_at_sql;
EXECUTE stmt_server_fsm_instances_locked_at;
DEALLOCATE PREPARE stmt_server_fsm_instances_locked_at;

SET @server_fsm_instances_locked_by_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'locked_by'
);
SET @server_fsm_instances_locked_by_sql := IF(
    @server_fsm_instances_locked_by_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN locked_by VARCHAR(100) NULL AFTER locked_at',
    'SELECT 1'
);
PREPARE stmt_server_fsm_instances_locked_by FROM @server_fsm_instances_locked_by_sql;
EXECUTE stmt_server_fsm_instances_locked_by;
DEALLOCATE PREPARE stmt_server_fsm_instances_locked_by;

SET @fsm_transitions_guard_name_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'guard_name'
);
SET @fsm_transitions_guard_name_sql := IF(
    @fsm_transitions_guard_name_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN guard_name VARCHAR(100) NULL AFTER to_state_id',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_guard_name FROM @fsm_transitions_guard_name_sql;
EXECUTE stmt_fsm_transitions_guard_name;
DEALLOCATE PREPARE stmt_fsm_transitions_guard_name;

SET @fsm_transitions_guard_params_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'guard_params'
);
SET @fsm_transitions_guard_params_sql := IF(
    @fsm_transitions_guard_params_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN guard_params JSON NULL AFTER guard_name',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_guard_params FROM @fsm_transitions_guard_params_sql;
EXECUTE stmt_fsm_transitions_guard_params;
DEALLOCATE PREPARE stmt_fsm_transitions_guard_params;

SET @fsm_transitions_effect_name_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'effect_name'
);
SET @fsm_transitions_effect_name_sql := IF(
    @fsm_transitions_effect_name_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN effect_name VARCHAR(100) NULL AFTER guard_params',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_effect_name FROM @fsm_transitions_effect_name_sql;
EXECUTE stmt_fsm_transitions_effect_name;
DEALLOCATE PREPARE stmt_fsm_transitions_effect_name;

SET @fsm_transitions_effect_params_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'effect_params'
);
SET @fsm_transitions_effect_params_sql := IF(
    @fsm_transitions_effect_params_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN effect_params JSON NULL AFTER effect_name',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_effect_params FROM @fsm_transitions_effect_params_sql;
EXECUTE stmt_fsm_transitions_effect_params;
DEALLOCATE PREPARE stmt_fsm_transitions_effect_params;

SET @fsm_transitions_timer_name_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'timer_name'
);
SET @fsm_transitions_timer_name_sql := IF(
    @fsm_transitions_timer_name_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN timer_name VARCHAR(100) NULL AFTER effect_params',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_timer_name FROM @fsm_transitions_timer_name_sql;
EXECUTE stmt_fsm_transitions_timer_name;
DEALLOCATE PREPARE stmt_fsm_transitions_timer_name;

SET @fsm_transitions_timer_params_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'timer_params'
);
SET @fsm_transitions_timer_params_sql := IF(
    @fsm_transitions_timer_params_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN timer_params JSON NULL AFTER timer_name',
    'SELECT 1'
);
PREPARE stmt_fsm_transitions_timer_params FROM @fsm_transitions_timer_params_sql;
EXECUTE stmt_fsm_transitions_timer_params;
DEALLOCATE PREPARE stmt_fsm_transitions_timer_params;

CREATE TABLE IF NOT EXISTS fsm_timers (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    process_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    timer_name VARCHAR(100) NOT NULL,
    timer_params JSON NULL,
    action_name VARCHAR(100) NOT NULL,
    due_at DATETIME NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    locked_at DATETIME NULL,
    locked_by VARCHAR(100) NULL,
    fired_at DATETIME NULL,
    last_error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fsm_timers_due (status, due_at),
    KEY idx_fsm_timers_entity (entity_type, entity_id),
    KEY idx_fsm_timers_process (service, process_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @fsm_timers_last_error_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_timers'
      AND COLUMN_NAME = 'last_error'
);
SET @fsm_timers_last_error_sql := IF(
    @fsm_timers_last_error_exists = 0,
    'ALTER TABLE fsm_timers ADD COLUMN last_error TEXT NULL AFTER fired_at',
    'SELECT 1'
);
PREPARE stmt_fsm_timers_last_error FROM @fsm_timers_last_error_sql;
EXECUTE stmt_fsm_timers_last_error;
DEALLOCATE PREPARE stmt_fsm_timers_last_error;

CREATE TABLE IF NOT EXISTS core_outbox (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id INT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    idempotency_key VARCHAR(128) NULL,
    locked_at DATETIME NULL,
    locked_by VARCHAR(100) NULL,
    last_error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_core_outbox_idempotency (idempotency_key),
    KEY idx_core_outbox_status (status, created_at),
    KEY idx_core_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS taxi_trips (
    id BIGINT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    driver_user_id INT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'trip_created',
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    actual_price DECIMAL(12, 2) NULL,
    currency VARCHAR(8) NULL,
    outcome VARCHAR(50) NULL,
    metadata_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_taxi_trips_order (order_id),
    KEY idx_taxi_trips_driver (driver_user_id),
    CONSTRAINT taxi_trips_ibfk_1 FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

START TRANSACTION;

INSERT INTO fsm_states (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'order_created' AS name, 'Order created' AS label
    UNION ALL SELECT 'order_vote_waiting_candidates', 'Vote: waiting for candidate drivers'
    UNION ALL SELECT 'order_vote_driver_assigned', 'Vote: driver selected as performer'
    UNION ALL SELECT 'order_vote_no_show', 'Vote: client no-show'
    UNION ALL SELECT 'order_driver_assigned', 'Driver assigned'
    UNION ALL SELECT 'order_driver_arrived', 'Driver arrived'
    UNION ALL SELECT 'order_in_ride', 'Ride in progress'
    UNION ALL SELECT 'order_completed', 'Order completed'
    UNION ALL SELECT 'order_cancelled', 'Order cancelled'
    UNION ALL SELECT 'order_expired', 'Order expired'
    UNION ALL SELECT 'ride_interrupted', 'Ride interrupted'
    UNION ALL SELECT 'order_offer_waiting', 'Offer: waiting for driver offers'
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_states s WHERE s.name = v.name
);

INSERT INTO fsm_actions (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'order_publish_vote' AS name, 'Publish Vote order' AS label
    UNION ALL SELECT 'order_select_candidate', 'Client selects candidate driver'
    UNION ALL SELECT 'order_release_candidate', 'Release selected candidate'
    UNION ALL SELECT 'order_cancel_by_client', 'Cancel order'
    UNION ALL SELECT 'order_no_show', 'Client no-show'
    UNION ALL SELECT 'order_arrive', 'Driver arrived'
    UNION ALL SELECT 'order_start', 'Start ride'
    UNION ALL SELECT 'order_finish', 'Finish ride'
    UNION ALL SELECT 'order_assign_direct', 'Assign driver directly'
    UNION ALL SELECT 'order_publish_offer', 'Publish Offer order'
    UNION ALL SELECT 'order_select_offer', 'Client selects driver offer'
    UNION ALL SELECT 'order_expire', 'Expire order'
    UNION ALL SELECT 'order_interrupt_ride', 'Interrupt ride'
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_actions a WHERE a.name = v.name
);

INSERT INTO fsm_transitions (from_state_id, action_id, to_state_id)
SELECT fs_from.id, action.id, fs_to.id
FROM (
    -- T5/T8 are context updates in orders.metadata_json, not FSM transitions.
    -- T15 expires only before assignment.
    -- T16 no-show is VOTE-only; DIRECT/OFFER pickup problems use order_cancelled.
    SELECT 'order_created' AS from_state, 'order_publish_vote' AS action_name, 'order_vote_waiting_candidates' AS to_state
    UNION ALL SELECT 'order_vote_waiting_candidates', 'order_select_candidate', 'order_vote_driver_assigned'
    UNION ALL SELECT 'order_vote_driver_assigned', 'order_release_candidate', 'order_vote_waiting_candidates'
    UNION ALL SELECT 'order_vote_driver_assigned', 'order_no_show', 'order_vote_no_show'
    UNION ALL SELECT 'order_created', 'order_assign_direct', 'order_driver_assigned'
    UNION ALL SELECT 'order_created', 'order_publish_offer', 'order_offer_waiting'
    UNION ALL SELECT 'order_offer_waiting', 'order_select_offer', 'order_driver_assigned'
    UNION ALL SELECT 'order_vote_driver_assigned', 'order_arrive', 'order_driver_arrived'
    UNION ALL SELECT 'order_driver_assigned', 'order_arrive', 'order_driver_arrived'
    UNION ALL SELECT 'order_driver_arrived', 'order_start', 'order_in_ride'
    UNION ALL SELECT 'order_in_ride', 'order_finish', 'order_completed'
    UNION ALL SELECT 'order_created', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_vote_waiting_candidates', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_vote_driver_assigned', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_driver_assigned', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_driver_arrived', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_offer_waiting', 'order_cancel_by_client', 'order_cancelled'
    UNION ALL SELECT 'order_created', 'order_expire', 'order_expired'
    UNION ALL SELECT 'order_vote_waiting_candidates', 'order_expire', 'order_expired'
    UNION ALL SELECT 'order_offer_waiting', 'order_expire', 'order_expired'
    UNION ALL SELECT 'order_in_ride', 'order_interrupt_ride', 'ride_interrupted'
) v
JOIN fsm_states fs_from ON fs_from.name = v.from_state
JOIN fsm_actions action ON action.name = v.action_name
JOIN fsm_states fs_to ON fs_to.name = v.to_state
WHERE NOT EXISTS (
    SELECT 1
    FROM fsm_transitions t
    JOIN fsm_states existing_from ON existing_from.id = t.from_state_id
    JOIN fsm_actions existing_action ON existing_action.id = t.action_id
    JOIN fsm_states existing_to ON existing_to.id = t.to_state_id
    WHERE existing_from.name = v.from_state
      AND existing_action.name = v.action_name
      AND existing_to.name = v.to_state
);

UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
SET t.guard_name = 'can_select_candidate',
    t.effect_name = 'create_trip'
WHERE fs_from.name = 'order_vote_waiting_candidates'
  AND action.name = 'order_select_candidate'
  AND fs_to.name = 'order_vote_driver_assigned';

UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
SET t.effect_name = 'create_trip'
WHERE fs_from.name = 'order_created'
  AND action.name = 'order_assign_direct'
  AND fs_to.name = 'order_driver_assigned';

UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
SET t.effect_name = 'create_trip'
WHERE fs_from.name = 'order_offer_waiting'
  AND action.name = 'order_select_offer'
  AND fs_to.name = 'order_driver_assigned';

UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
SET t.guard_name = 'can_start_ride',
    t.effect_name = 'mark_trip_started'
WHERE fs_from.name = 'order_driver_arrived'
  AND action.name = 'order_start'
  AND fs_to.name = 'order_in_ride';

UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
JOIN fsm_states fs_to ON fs_to.id = t.to_state_id
SET t.effect_name = 'mark_trip_finished'
WHERE fs_from.name = 'order_in_ride'
  AND action.name = 'order_finish'
  AND fs_to.name = 'order_completed';

UPDATE fsm_transitions t
JOIN fsm_actions action ON action.id = t.action_id
SET t.guard_name = 'can_cancel_order'
WHERE action.name = 'order_cancel_by_client';

-- Driver cancels a taken order. The order waits in order_driver_cancel_pending
-- until Core confirms set_cancel_state via core_outbox, then becomes
-- order_cancelled; on a final Core failure it returns to its previous state.
INSERT INTO fsm_states (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'order_driver_cancel_pending' AS name, 'Driver cancellation awaiting Core' AS label
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_states s WHERE s.name = v.name
);

INSERT INTO fsm_actions (name, label)
SELECT v.name, v.label
FROM (
    SELECT 'order_cancel_by_driver' AS name, 'Assigned driver cancels order' AS label
    UNION ALL SELECT 'order_confirm_driver_cancel', 'Core confirmed driver cancellation'
    UNION ALL SELECT 'order_revert_driver_cancel_to_vote_assigned', 'Revert failed driver cancellation (vote)'
    UNION ALL SELECT 'order_revert_driver_cancel_to_assigned', 'Revert failed driver cancellation (assigned)'
    UNION ALL SELECT 'order_revert_driver_cancel_to_arrived', 'Revert failed driver cancellation (arrived)'
) v
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_actions a WHERE a.name = v.name
);

INSERT INTO fsm_transitions (from_state_id, action_id, to_state_id)
SELECT fs_from.id, action.id, fs_to.id
FROM (
    SELECT 'order_vote_driver_assigned' AS from_state, 'order_cancel_by_driver' AS action_name, 'order_driver_cancel_pending' AS to_state
    UNION ALL SELECT 'order_driver_assigned', 'order_cancel_by_driver', 'order_driver_cancel_pending'
    UNION ALL SELECT 'order_driver_arrived', 'order_cancel_by_driver', 'order_driver_cancel_pending'
    UNION ALL SELECT 'order_driver_cancel_pending', 'order_confirm_driver_cancel', 'order_cancelled'
    UNION ALL SELECT 'order_driver_cancel_pending', 'order_revert_driver_cancel_to_vote_assigned', 'order_vote_driver_assigned'
    UNION ALL SELECT 'order_driver_cancel_pending', 'order_revert_driver_cancel_to_assigned', 'order_driver_assigned'
    UNION ALL SELECT 'order_driver_cancel_pending', 'order_revert_driver_cancel_to_arrived', 'order_driver_arrived'
) v
JOIN fsm_states fs_from ON fs_from.name = v.from_state
JOIN fsm_actions action ON action.name = v.action_name
JOIN fsm_states fs_to ON fs_to.name = v.to_state
WHERE NOT EXISTS (
    SELECT 1
    FROM fsm_transitions t
    JOIN fsm_states existing_from ON existing_from.id = t.from_state_id
    JOIN fsm_actions existing_action ON existing_action.id = t.action_id
    JOIN fsm_states existing_to ON existing_to.id = t.to_state_id
    WHERE existing_from.name = v.from_state
      AND existing_action.name = v.action_name
      AND existing_to.name = v.to_state
);

-- previous_state lets a failed Core call revert to the exact source state.
UPDATE fsm_transitions t
JOIN fsm_states fs_from ON fs_from.id = t.from_state_id
JOIN fsm_actions action ON action.id = t.action_id
SET t.guard_name = 'can_driver_cancel_order',
    t.effect_name = 'request_core_driver_cancel',
    t.effect_params = JSON_OBJECT('previous_state', fs_from.name)
WHERE action.name = 'order_cancel_by_driver';

UPDATE fsm_transitions t
JOIN fsm_actions action ON action.id = t.action_id
SET t.effect_name = 'finish_driver_cancel_request',
    t.effect_params = JSON_OBJECT('outcome', 'confirmed')
WHERE action.name = 'order_confirm_driver_cancel';

UPDATE fsm_transitions t
JOIN fsm_actions action ON action.id = t.action_id
SET t.effect_name = 'finish_driver_cancel_request',
    t.effect_params = JSON_OBJECT('outcome', 'reverted')
WHERE action.name IN (
    'order_revert_driver_cancel_to_vote_assigned',
    'order_revert_driver_cancel_to_assigned',
    'order_revert_driver_cancel_to_arrived'
);

COMMIT;
