-- Deferred command completion: link an outbox event to follow-up triggers.
-- completion_json holds {processName, onSentTrigger, onFailedTrigger,
-- commandInstanceId}; NULL keeps the previous fire-and-forget behaviour.
-- Apply after 005_outbox_realtime.sql (and 006_command_api.sql when the
-- Command API is installed). The statement is idempotent.

SET @column_exists := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_outbox'
      AND COLUMN_NAME = 'completion_json'
);
SET @ddl := IF(@column_exists = 0,
    'ALTER TABLE core_outbox ADD COLUMN completion_json JSON NULL AFTER response_json',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
