#!/usr/bin/env bash
# Build and (re)start the stack with the database schema migrated first.
#
#   1. build the new images (the running site keeps serving meanwhile)
#   2. start MySQL and apply pending backend/migrations/*.sql
#   3. with DB_AUTO_MIGRATE=false, verify with the NEW backend image that every
#      table/column the code needs exists; abort the release if not
#   4. start / recreate the remaining services
#
# Environment:
#   COMPOSE            compose command override (see lib-compose.sh)
#   ENV_FILE           env file read for DB_AUTO_MIGRATE (default: .env)
#   SKIP_SCHEMA_CHECK  set to 1 to skip step 3 (not recommended)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
# shellcheck source=lib-compose.sh
source "$SCRIPT_DIR/lib-compose.sh"
resolve_compose_cmd

ENV_FILE="${ENV_FILE:-.env}"

# Create .env from example if missing (safe for git; .env is ignored)
if [[ ! -f "$ENV_FILE" && "$ENV_FILE" == ".env" ]]; then
  cp .env.docker.example .env
  echo "Created .env from .env.docker.example"
fi

echo "==> Building images"
"${COMPOSE_CMD[@]}" build

echo "==> Starting MySQL"
"${COMPOSE_CMD[@]}" up -d mysql

"$SCRIPT_DIR/apply-migrations.sh"

auto_migrate="$(env_file_value "$ENV_FILE" DB_AUTO_MIGRATE)"
if [[ "${auto_migrate:-true}" == "false" ]]; then
  if [[ "${SKIP_SCHEMA_CHECK:-0}" == "1" ]]; then
    echo "warning: SKIP_SCHEMA_CHECK=1, not verifying the database schema" >&2
  else
    echo "==> Verifying the database schema against the new backend"
    if ! "${COMPOSE_CMD[@]}" run --rm --no-deps -T backend /app/schema-check; then
      echo "error: release aborted, the running services were left untouched." >&2
      echo "       Add the missing tables/columns as a migration under backend/migrations/ and rerun." >&2
      exit 1
    fi
  fi
fi

echo "==> Starting services"
"${COMPOSE_CMD[@]}" up -d
"${COMPOSE_CMD[@]}" ps
