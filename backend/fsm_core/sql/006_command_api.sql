-- Command API: durable idempotency for external intents.
-- MySQL DDL commits implicitly; statements are intentionally idempotent.

CREATE TABLE IF NOT EXISTS fsm_command_idempotency (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    scope VARCHAR(64) NOT NULL DEFAULT 'command',
    idempotency_key VARCHAR(128) NOT NULL,
    instance_id BIGINT NULL,
    response_json JSON NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fsm_command_idempotency (service, scope, idempotency_key),
    UNIQUE KEY uq_fsm_command_idempotency_instance (instance_id),
    KEY idx_fsm_command_idempotency_expires (expires_at),
    KEY idx_fsm_command_idempotency_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotent ALTERs for databases that already have the table from a previous
-- version of migration 006 (without the status column / status index / instance
-- unique key). Each block is a no-op when the column/index already exists.

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fsm_command_idempotency'
      AND COLUMN_NAME = 'status'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE fsm_command_idempotency ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT ''PENDING'' AFTER response_json',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fsm_command_idempotency'
      AND INDEX_NAME = 'idx_fsm_command_idempotency_status'
);
SET @ddl := IF(@index_exists = 0,
    'CREATE INDEX idx_fsm_command_idempotency_status ON fsm_command_idempotency (status)',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One instance_id → one command execution. The unique key is allowed to be NULL
-- (PENDING rows that have not yet been linked), and once set it must be unique.
--
-- PRECONDITION CHECK: if the table already contains duplicate non-NULL
-- instance_id values (e.g. from a pre-TASK-CORE-001 deployment that did not
-- enforce uniqueness), CREATE UNIQUE INDEX will fail with "Duplicate entry".
-- This is intentional — duplicates must be resolved manually before the
-- migration can proceed. The SELECT below surfaces them so the operator sees
-- a clear diagnostic in the migration log instead of a raw DDL error.
--
-- To check beforehand, run:
--   SELECT instance_id, COUNT(*) FROM fsm_command_idempotency
--   WHERE instance_id IS NOT NULL GROUP BY instance_id HAVING COUNT(*) > 1;
-- Empty result → safe to apply. Non-empty → resolve duplicates first.
SELECT
    CONCAT(
        'WARNING: duplicate instance_id values detected in fsm_command_idempotency; ',
        'CREATE UNIQUE INDEX will fail. Resolve duplicates before re-running migration 006.'
    ) AS migration_warning
FROM (
    SELECT instance_id
    FROM fsm_command_idempotency
    WHERE instance_id IS NOT NULL
    GROUP BY instance_id
    HAVING COUNT(*) > 1
    LIMIT 1
) dup;

SET @index_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fsm_command_idempotency'
      AND INDEX_NAME = 'uq_fsm_command_idempotency_instance'
);
SET @ddl := IF(@index_exists = 0,
    'CREATE UNIQUE INDEX uq_fsm_command_idempotency_instance ON fsm_command_idempotency (instance_id)',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill status for legacy rows that pre-date the column (should be a no-op
-- after the ALTER above because of the DEFAULT, but kept defensively).
UPDATE fsm_command_idempotency
SET status = 'PENDING'
WHERE status IS NULL OR status = '';
