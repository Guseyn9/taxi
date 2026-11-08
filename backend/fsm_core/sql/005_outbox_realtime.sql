-- Stage 4: post-commit outbox delivery and durable realtime events.
-- MySQL DDL commits implicitly; statements are intentionally idempotent.

CREATE TABLE IF NOT EXISTS core_outbox (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id INT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    handler_name VARCHAR(100) NOT NULL DEFAULT 'core_http',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 8,
    idempotency_key VARCHAR(128) NOT NULL,
    next_attempt_at DATETIME NULL,
    locked_at DATETIME NULL,
    locked_by VARCHAR(100) NULL,
    sent_at DATETIME NULL,
    response_json JSON NULL,
    last_error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_core_outbox_idempotency (idempotency_key),
    KEY idx_core_outbox_dispatch (status, next_attempt_at, created_at),
    KEY idx_core_outbox_aggregate (service, aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'handler_name'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN handler_name VARCHAR(100) NOT NULL DEFAULT ''core_http'' AFTER payload',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'max_attempts'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN max_attempts INT NOT NULL DEFAULT 8 AFTER attempts',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'next_attempt_at'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN next_attempt_at DATETIME NULL AFTER idempotency_key',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'sent_at'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN sent_at DATETIME NULL AFTER locked_by',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'response_json'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN response_json JSON NULL AFTER sent_at',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE core_outbox
SET idempotency_key = CONCAT('legacy-core-outbox-', id)
WHERE idempotency_key IS NULL OR idempotency_key = '';

SET @column_nullable := (
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'idempotency_key'
);
SET @ddl := IF(@column_nullable = 'YES',
    'ALTER TABLE core_outbox MODIFY COLUMN idempotency_key VARCHAR(128) NOT NULL',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @index_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND INDEX_NAME = 'idx_core_outbox_dispatch'
);
SET @ddl := IF(@index_exists = 0,
    'CREATE INDEX idx_core_outbox_dispatch ON core_outbox (status, next_attempt_at, created_at)',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS realtime_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    locked_at DATETIME NULL,
    locked_by VARCHAR(100) NULL,
    published_at DATETIME NULL,
    subscriber_count INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_realtime_publish (status, id),
    KEY idx_realtime_replay (service, entity_type, entity_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

