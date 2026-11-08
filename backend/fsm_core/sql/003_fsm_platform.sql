-- Stage 3: declarative FSM Platform and optimistic SQL Core.
-- This is an idempotent migration for the existing project database.
-- MySQL DDL commits implicitly, so DDL is intentionally outside a transaction.

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'service'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN service VARCHAR(50) NULL AFTER id',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'entity_type'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN entity_type VARCHAR(50) NULL AFTER service',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'guard_name'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN guard_name VARCHAR(100) NULL AFTER to_state_id',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'guard_params'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN guard_params JSON NULL AFTER guard_name',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'effect_name'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN effect_name VARCHAR(100) NULL AFTER guard_params',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'effect_params'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN effect_params JSON NULL AFTER effect_name',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'timer_name'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN timer_name VARCHAR(100) NULL AFTER effect_params',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND COLUMN_NAME = 'timer_params'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_transitions ADD COLUMN timer_params JSON NULL AFTER timer_name',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_action_logs'
      AND COLUMN_NAME = 'service'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE fsm_action_logs ADD COLUMN service VARCHAR(50) NULL AFTER id',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fsm_transitions'
      AND INDEX_NAME = 'idx_fsm_transition_lookup_v2'
);
SET @ddl := IF(
    @index_exists = 0,
    'CREATE INDEX idx_fsm_transition_lookup_v2 ON fsm_transitions (service, entity_type, from_state_id, action_id)',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS fsm_entity_bindings (
    service VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    id_column VARCHAR(64) NOT NULL DEFAULT 'id',
    state_column VARCHAR(64) NOT NULL DEFAULT 'status',
    PRIMARY KEY (service, entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO fsm_entity_bindings (service, entity_type, table_name, id_column, state_column)
SELECT 'courier', 'order', 'orders', 'id', 'status'
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_entity_bindings WHERE service = 'courier' AND entity_type = 'order'
);
INSERT INTO fsm_entity_bindings (service, entity_type, table_name, id_column, state_column)
SELECT 'courier', 'trip', 'trips', 'id', 'status'
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_entity_bindings WHERE service = 'courier' AND entity_type = 'trip'
);
INSERT INTO fsm_entity_bindings (service, entity_type, table_name, id_column, state_column)
SELECT 'courier', 'locker', 'locker_cells', 'id', 'status'
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_entity_bindings WHERE service = 'courier' AND entity_type = 'locker'
);
INSERT INTO fsm_entity_bindings (service, entity_type, table_name, id_column, state_column)
SELECT 'taxi', 'order', 'orders', 'id', 'status'
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_entity_bindings WHERE service = 'taxi' AND entity_type = 'order'
);

DROP PROCEDURE IF EXISTS fsm_perform_action_v2;
DELIMITER $$
CREATE PROCEDURE fsm_perform_action_v2(
    IN p_service VARCHAR(50),
    IN p_entity_type VARCHAR(50),
    IN p_entity_id INT,
    IN p_action_name VARCHAR(100),
    IN p_expected_state VARCHAR(100),
    IN p_user_id INT,
    IN p_extra_id VARCHAR(255)
)
proc: BEGIN
    DECLARE v_table_name VARCHAR(64);
    DECLARE v_id_column VARCHAR(64);
    DECLARE v_state_column VARCHAR(64);
    DECLARE v_action_id INT;
    DECLARE v_from_state_id INT;
    DECLARE v_next_state_id INT;
    DECLARE v_next_state VARCHAR(100);
    DECLARE v_updated INT DEFAULT 0;
    DECLARE v_error_message TEXT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_error_message = MESSAGE_TEXT;
        INSERT INTO fsm_errors_log (
            error_time, error_message, entity_type, entity_id, action_name, user_id
        ) VALUES (
            NOW(), v_error_message, p_entity_type, p_entity_id, p_action_name, p_user_id
        );
        SELECT 'SQL_ERROR' AS result_code, v_error_message AS message;
    END;

    -- Bindings are platform configuration, not business data or business rules.
    SELECT table_name, id_column, state_column
      INTO v_table_name, v_id_column, v_state_column
    FROM fsm_entity_bindings
    WHERE service = p_service AND entity_type = p_entity_type;

    IF v_table_name IS NULL THEN
        SELECT 'UNKNOWN_ENTITY_TYPE' AS result_code,
               CONCAT(p_service, '/', p_entity_type) AS message;
        LEAVE proc;
    END IF;

    IF v_table_name NOT REGEXP '^[A-Za-z0-9_]+$'
       OR v_id_column NOT REGEXP '^[A-Za-z0-9_]+$'
       OR v_state_column NOT REGEXP '^[A-Za-z0-9_]+$' THEN
        SELECT 'INVALID_ENTITY_BINDING' AS result_code,
               CONCAT(p_service, '/', p_entity_type) AS message;
        LEAVE proc;
    END IF;

    SELECT id INTO v_action_id FROM fsm_actions WHERE name = p_action_name LIMIT 1;
    SELECT id INTO v_from_state_id FROM fsm_states WHERE name = p_expected_state LIMIT 1;
    IF v_action_id IS NULL OR v_from_state_id IS NULL THEN
        SELECT 'UNKNOWN_ACTION_OR_STATE' AS result_code,
               CONCAT(p_expected_state, ' + ', p_action_name) AS message;
        LEAVE proc;
    END IF;

    SELECT t.to_state_id, target.name
      INTO v_next_state_id, v_next_state
    FROM fsm_transitions t
    JOIN fsm_states target ON target.id = t.to_state_id
    WHERE t.from_state_id = v_from_state_id
      AND t.action_id = v_action_id
      AND (t.service = p_service OR t.service IS NULL)
      AND (t.entity_type = p_entity_type OR t.entity_type IS NULL)
    ORDER BY
      CASE WHEN t.service = p_service THEN 0 ELSE 1 END,
      CASE WHEN t.entity_type = p_entity_type THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_next_state_id IS NULL THEN
        SELECT 'INVALID_TRANSITION' AS result_code,
               CONCAT(p_expected_state, ' + ', p_action_name) AS message;
        LEAVE proc;
    END IF;

    SET @fsm_next_state = v_next_state;
    SET @fsm_entity_id = p_entity_id;
    SET @fsm_expected_state = p_expected_state;
    SET @fsm_update_sql = CONCAT(
        'UPDATE `', v_table_name, '` SET `', v_state_column, '` = ? ',
        'WHERE `', v_id_column, '` = ? AND `', v_state_column, '` = ?'
    );
    PREPARE fsm_update_stmt FROM @fsm_update_sql;
    EXECUTE fsm_update_stmt USING @fsm_next_state, @fsm_entity_id, @fsm_expected_state;
    SET v_updated = ROW_COUNT();
    DEALLOCATE PREPARE fsm_update_stmt;

    IF v_updated = 0 THEN
        SELECT 'TRANSITION_CONFLICT' AS result_code,
               CONCAT('Expected state ', p_expected_state, ' is stale or entity is missing') AS message;
        LEAVE proc;
    END IF;

    INSERT INTO fsm_action_logs (
        service, entity_type, entity_id, action_name,
        from_state, to_state, user_id, created_at
    ) VALUES (
        p_service, p_entity_type, p_entity_id, p_action_name,
        p_expected_state, v_next_state, p_user_id, NOW()
    );

    SELECT 'OK' AS result_code,
           CONCAT('FSM action completed: ', p_expected_state, ' -> ', v_next_state) AS message;
END$$
DELIMITER ;

