CREATE TABLE IF NOT EXISTS fsm_order_create_keys (
 user_id INT NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
 local_order_id INT NULL, request_digest CHAR(64) NOT NULL,
 PRIMARY KEY(user_id,idempotency_key)
) ENGINE=InnoDB;
