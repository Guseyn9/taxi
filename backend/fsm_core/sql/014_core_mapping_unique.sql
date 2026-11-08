-- Refuse duplicate mappings rather than silently adopting an arbitrary row.
SET @present := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='core_order_mapping' AND INDEX_NAME='uq_core_order');
SET @ddl := IF(@present=0,'CREATE UNIQUE INDEX uq_core_order ON core_order_mapping(core_order_id)','SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
