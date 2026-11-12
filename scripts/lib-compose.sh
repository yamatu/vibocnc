#!/usr/bin/env bash
# Resolve the Docker Compose command into the COMPOSE_CMD array.
#
# Order: $COMPOSE (e.g. "docker-compose -f docker-compose.yml -f docker-compose.prod.yml"),
# then the v2 plugin "docker compose", then the standalone v1 "docker-compose".
# COMPOSE_FILE / COMPOSE_PROJECT_NAME in the environment or .env are honoured by
# both versions, so most setups need no override.
#
# Sourced by the other scripts in this directory:
#   source "$(dirname "$0")/lib-compose.sh"
#   "${COMPOSE_CMD[@]}" ps
resolve_compose_cmd() {
  COMPOSE_CMD=()
  if [[ -n "${COMPOSE:-}" ]]; then
    read -r -a COMPOSE_CMD <<<"$COMPOSE"
  elif docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    echo "error: neither 'docker compose' nor 'docker-compose' is available" >&2
    return 1
  fi
}
