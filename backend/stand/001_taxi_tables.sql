CREATE TABLE IF NOT EXISTS orders (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 status VARCHAR(100) NOT NULL DEFAULT 'order_created',
 description VARCHAR(255), metadata_json JSON
) ENGINE=InnoDB;
-- Shared Core mapping for taxi/courier. User ids are Core u_id, not a second namespace.
CREATE TABLE IF NOT EXISTS core_order_mapping (
 local_order_id INT NOT NULL PRIMARY KEY, core_order_id INT NULL,
 role VARCHAR(50), kind INT, `upper` INT, b_state INT,
 client_local_user_id INT, performer_local_user_id INT,
 UNIQUE KEY uq_core_order(core_order_id)
) ENGINE=InnoDB;
