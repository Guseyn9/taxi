-- Apply after 008 and the taxi schema. Additive and restartable on MySQL 8.
CREATE TABLE IF NOT EXISTS fsm_transition_invocations (
 transition_id INT NOT NULL PRIMARY KEY,
 handler_name VARCHAR(100) NOT NULL,
 request_builder VARCHAR(100) NOT NULL,
 on_error_trigger VARCHAR(100) NULL,
 max_wait_seconds INT NOT NULL DEFAULT 600,
 FOREIGN KEY (transition_id) REFERENCES fsm_transitions(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS fsm_entity_locks (
 service VARCHAR(50) NOT NULL, entity_type VARCHAR(50) NOT NULL, entity_id INT NOT NULL,
 command_instance_id BIGINT NULL, outbox_event_id BIGINT NOT NULL,
 action_name VARCHAR(100) NOT NULL, locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at DATETIME NOT NULL,
 PRIMARY KEY(service,entity_type,entity_id), UNIQUE KEY(outbox_event_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS fsm_command_credentials (
 instance_id BIGINT NOT NULL PRIMARY KEY, credentials_encrypted TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS fsm_sync_mismatches (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 service VARCHAR(50) NOT NULL, entity_type VARCHAR(50) NOT NULL, entity_id INT NOT NULL,
 outbox_event_id BIGINT NULL, reason VARCHAR(100) NOT NULL,
 observed_json JSON NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at DATETIME NULL, resolution VARCHAR(255) NULL,
 UNIQUE KEY uq_mismatch_outbox(outbox_event_id),
 KEY idx_mismatch_entity(service,entity_type,entity_id,resolved_at)
) ENGINE=InnoDB;
SET @present := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='core_outbox' AND COLUMN_NAME='credentials_encrypted');
SET @ddl := IF(@present=0,'ALTER TABLE core_outbox ADD COLUMN credentials_encrypted TEXT NULL','SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
