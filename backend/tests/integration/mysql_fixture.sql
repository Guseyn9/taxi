CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT,
    status VARCHAR(100) NOT NULL DEFAULT 'order_created',
    description VARCHAR(255) NULL,
    metadata_json JSON NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS core_order_mapping (
    local_order_id INT NOT NULL,
    core_order_id INT NULL,
    role VARCHAR(50) NULL,
    kind INT NULL,
    `upper` INT NULL,
    b_state INT NULL,
    client_local_user_id INT NULL,
    performer_local_user_id INT NULL,
    PRIMARY KEY (local_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS taxi_trips (
    id INT NOT NULL AUTO_INCREMENT,
    order_id INT NOT NULL,
    driver_user_id INT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'trip_created',
    metadata_json JSON NULL,
    actual_price DECIMAL(12,2) NULL,
    currency VARCHAR(10) NULL,
    outcome VARCHAR(50) NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_taxi_trip_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO fsm_states (name, label)
SELECT 'order_created', 'Order created'
WHERE NOT EXISTS (SELECT 1 FROM fsm_states WHERE name = 'order_created');

INSERT INTO fsm_states (name, label)
SELECT 'order_vote_waiting_candidates', 'Vote waiting'
WHERE NOT EXISTS (
    SELECT 1 FROM fsm_states WHERE name = 'order_vote_waiting_candidates'
);

INSERT INTO fsm_actions (name, label)
SELECT 'order_publish_vote', 'Publish vote'
WHERE NOT EXISTS (SELECT 1 FROM fsm_actions WHERE name = 'order_publish_vote');

INSERT INTO fsm_transitions (
    service, entity_type, from_state_id, action_id, to_state_id,
    effect_name, effect_params
)
SELECT
    'taxi',
    'order',
    fs_from.id,
    action.id,
    fs_to.id,
    'write_core_outbox',
    JSON_OBJECT(
        'event_type', 'publish_vote',
        'idempotency_key', 'integration-publish-vote',
        'handler_name', 'test_core',
        'request', JSON_OBJECT(
            'method', 'POST',
            'path', '/orders/publish-vote',
            'body', JSON_OBJECT('mode', 'VOTE')
        )
    )
FROM fsm_states fs_from
JOIN fsm_actions action ON action.name = 'order_publish_vote'
JOIN fsm_states fs_to ON fs_to.name = 'order_vote_waiting_candidates'
WHERE fs_from.name = 'order_created'
  AND NOT EXISTS (
      SELECT 1
      FROM fsm_transitions existing
      WHERE existing.service = 'taxi'
        AND existing.entity_type = 'order'
        AND existing.from_state_id = fs_from.id
        AND existing.action_id = action.id
  );
