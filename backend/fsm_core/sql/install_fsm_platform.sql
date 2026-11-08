-- Clean FSM Platform Stage 3 schema for MySQL 8.0+.
-- Domain tables and domain state/action/transition seeds are installed separately.

CREATE TABLE IF NOT EXISTS fsm_states (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    label VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fsm_states_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fsm_actions (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    label VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fsm_actions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fsm_transitions (
    id INT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NULL,
    entity_type VARCHAR(50) NULL,
    from_state_id INT NOT NULL,
    action_id INT NOT NULL,
    to_state_id INT NOT NULL,
    guard_name VARCHAR(100) NULL,
    guard_params JSON NULL,
    effect_name VARCHAR(100) NULL,
    effect_params JSON NULL,
    timer_name VARCHAR(100) NULL,
    timer_params JSON NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_fsm_transition_scope (
        service, entity_type, from_state_id, action_id
    ),
    KEY idx_fsm_transition_lookup_v2 (
        service, entity_type, from_state_id, action_id
    ),
    CONSTRAINT fk_fsm_transition_from FOREIGN KEY (from_state_id) REFERENCES fsm_states (id),
    CONSTRAINT fk_fsm_transition_action FOREIGN KEY (action_id) REFERENCES fsm_actions (id),
    CONSTRAINT fk_fsm_transition_to FOREIGN KEY (to_state_id) REFERENCES fsm_states (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fsm_action_logs (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    action_name VARCHAR(100) NOT NULL,
    from_state VARCHAR(100) NOT NULL,
    to_state VARCHAR(100) NOT NULL,
    user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fsm_action_log_entity (service, entity_type, entity_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fsm_errors_log (
    id BIGINT NOT NULL AUTO_INCREMENT,
    error_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id INT NULL,
    action_name VARCHAR(100) NULL,
    user_id INT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS fsm_entity_bindings (
    service VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    id_column VARCHAR(64) NOT NULL DEFAULT 'id',
    state_column VARCHAR(64) NOT NULL DEFAULT 'status',
    PRIMARY KEY (service, entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS server_fsm_instances (
    id BIGINT NOT NULL AUTO_INCREMENT,
    service VARCHAR(50) NOT NULL,
    process_name VARCHAR(100) NOT NULL,
    instance_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    trigger_type VARCHAR(32) NULL,
    trigger_name VARCHAR(100) NULL,
    trigger_payload JSON NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT NOT NULL,
    fsm_state VARCHAR(100) NULL,
    attempts_count INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    requested_by_user_id INT NULL,
    requested_user_role VARCHAR(50) NULL,
    target_user_id INT NULL,
    target_role VARCHAR(50) NULL,
    metadata_json JSON NULL,
    locked_at DATETIME NULL,
    locked_by VARCHAR(100) NULL,
    processing_started_at DATETIME NULL,
    processing_finished_at DATETIME NULL,
    result_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_fsm_instances_worker_claim (instance_status, service, id),
    KEY idx_fsm_instances_entity (service, entity_type, entity_id),
    KEY idx_fsm_instances_process (service, process_name, instance_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The procedure body is installed by 003_fsm_platform.sql for legacy databases.
-- For a clean install, apply 003_fsm_platform.sql after this file as well; all
-- of its DDL checks are idempotent and it creates fsm_perform_action_v2.

