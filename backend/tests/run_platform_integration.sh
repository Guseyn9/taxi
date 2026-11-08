#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/tests/integration/docker-compose.yml"
PROJECT_NAME="fsm-platform-integration-$$"

cleanup() {
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true

}
trap cleanup EXIT

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d --wait

mysql_exec() {
  docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T mysql \
    mysql -uroot -proot fsm_platform_test
}

mysql_exec < "$ROOT_DIR/fsm_core/sql/install_fsm_platform.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/003_fsm_platform.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/005_outbox_realtime.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/008_outbox_command_completion.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/006_command_api.sql"
mysql_exec < "$ROOT_DIR/tests/integration/mysql_fixture.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/009_transition_invocations.sql"
mysql_exec < "$ROOT_DIR/fsm_core/sql/013_core_delivery_attempt.sql"

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" \
  --profile test run --rm \
  test
