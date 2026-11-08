-- Stage 2: runtime fields required by the generic FSM instance worker.
-- MySQL DDL commits implicitly, therefore this migration is intentionally not
-- wrapped in START TRANSACTION. Every statement is safe to run repeatedly.

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'service'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN service VARCHAR(50) NULL AFTER id',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'instance_status'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN instance_status VARCHAR(32) NOT NULL DEFAULT ''PENDING'' AFTER process_name',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_type'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_type VARCHAR(32) NULL AFTER instance_status',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_name'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_name VARCHAR(100) NULL AFTER trigger_type',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'trigger_payload'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN trigger_payload JSON NULL AFTER trigger_name',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'locked_at'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN locked_at DATETIME NULL AFTER next_timer_at',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'locked_by'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN locked_by VARCHAR(100) NULL AFTER locked_at',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'processing_started_at'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN processing_started_at DATETIME NULL AFTER locked_by',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'processing_finished_at'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN processing_finished_at DATETIME NULL AFTER processing_started_at',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND COLUMN_NAME = 'result_json'
);
SET @ddl := IF(
    @column_exists = 0,
    'ALTER TABLE server_fsm_instances ADD COLUMN result_json JSON NULL AFTER processing_finished_at',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'server_fsm_instances'
      AND INDEX_NAME = 'idx_fsm_instances_worker_claim'
);
SET @ddl := IF(
    @index_exists = 0,
    'CREATE INDEX idx_fsm_instances_worker_claim ON server_fsm_instances (instance_status, service, id)',
    'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

