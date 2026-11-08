-- Written durably BEFORE network mutation. Auth/read failures do not set it.
SET @present := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='core_outbox' AND COLUMN_NAME='write_attempted');
SET @ddl := IF(@present=0,'ALTER TABLE core_outbox ADD COLUMN write_attempted TINYINT NOT NULL DEFAULT 0','SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
