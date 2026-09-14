#!/usr/bin/env bash
# Repair the MySQL credentials of an existing Docker volume without deleting data.
#
# Why this exists: the MySQL image only applies MYSQL_USER/MYSQL_PASSWORD/
# MYSQL_ROOT_PASSWORD when it initialises an EMPTY data directory. If the .env
# password is changed later, the stored users keep the old password and every
# connection fails with "ERROR 1045 Access denied". The usual advice is to delete
# the volume (docker compose down -v), which destroys all data.
# This script instead starts a temporary mysqld with --skip-grant-tables on the
# same volume, resets the passwords to the values in .env, and restarts MySQL.
#
# Usage:
#   scripts/repair-mysql-credentials.sh [env-file]      # default: .env
#
# Overridable via environment:
#   MYSQL_IMAGE      (default mysql:8.0, must match docker-compose.yml)
#   MYSQL_CONTAINER  (default vibocnc_mysql)
#   MYSQL_VOLUME     (default vibocnc_mysql_data)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"

ENV_FILE="${1:-.env}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-vibocnc_mysql}"
MYSQL_VOLUME="${MYSQL_VOLUME:-vibocnc_mysql_data}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file '$ENV_FILE' not found" >&2
  exit 1
fi

ROOT_PASSWORD="$(env_file_value "$ENV_FILE" MYSQL_ROOT_PASSWORD)"
APP_USER="$(env_file_value "$ENV_FILE" MYSQL_USER)"
APP_PASSWORD="$(env_file_value "$ENV_FILE" MYSQL_PASSWORD)"
APP_DATABASE="$(env_file_value "$ENV_FILE" MYSQL_DATABASE)"

if [[ -z "$ROOT_PASSWORD" || -z "$APP_USER" || -z "$APP_PASSWORD" || -z "$APP_DATABASE" ]]; then
  echo "error: $ENV_FILE must define MYSQL_ROOT_PASSWORD, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE" >&2
  exit 1
fi

echo "==> Stopping '$MYSQL_CONTAINER' (if running)"
docker stop "$MYSQL_CONTAINER" >/dev/null 2>&1 || true

SQL_FILE="$(mktemp)"
cleanup() {
  docker rm -f vibocnc_mysql_repair >/dev/null 2>&1 || true
  rm -f "$SQL_FILE"
}
trap cleanup EXIT

# MySQL 8 can no longer create users with the default caching_sha2_password
# plugin while running with --skip-grant-tables, so mysql_native_password keeps
# the reset compatible with the app user created by the image entrypoint.
{
  echo "FLUSH PRIVILEGES;"
  for host in '%' 'localhost'; do
    echo "CREATE USER IF NOT EXISTS $(env_sql_quote "$APP_USER")@$(env_sql_quote "$host") IDENTIFIED WITH mysql_native_password BY $(env_sql_quote "$APP_PASSWORD");"
    echo "ALTER USER $(env_sql_quote "$APP_USER")@$(env_sql_quote "$host") IDENTIFIED WITH mysql_native_password BY $(env_sql_quote "$APP_PASSWORD");"
  done
  for host in '%' 'localhost'; do
    echo "ALTER USER 'root'@$(env_sql_quote "$host") IDENTIFIED WITH mysql_native_password BY $(env_sql_quote "$ROOT_PASSWORD");"
  done
  echo "GRANT ALL PRIVILEGES ON $(env_sql_identifier "$APP_DATABASE").* TO $(env_sql_quote "$APP_USER")@'%';"
  echo "GRANT ALL PRIVILEGES ON $(env_sql_identifier "$APP_DATABASE").* TO $(env_sql_quote "$APP_USER")@'localhost';"
  echo "FLUSH PRIVILEGES;"
} >"$SQL_FILE"

echo "==> Resetting stored passwords on volume '$MYSQL_VOLUME' (data is preserved)"
docker run --rm -d \
  --name vibocnc_mysql_repair \
  -v "${MYSQL_VOLUME}:/var/lib/mysql" \
  "$MYSQL_IMAGE" \
  --skip-grant-tables --skip-networking >/dev/null

echo "==> Waiting for the temporary server to accept connections"
ready=0
for _ in $(seq 1 60); do
  if docker exec vibocnc_mysql_repair mysqladmin ping --silent >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != "1" ]]; then
  echo "error: the temporary MySQL instance did not become ready" >&2
  exit 1
fi

docker exec -i vibocnc_mysql_repair mysql --protocol=socket -uroot <"$SQL_FILE"
cleanup
trap - EXIT

echo "==> Restarting '$MYSQL_CONTAINER'"
docker start "$MYSQL_CONTAINER" >/dev/null 2>&1 || echo "note: '$MYSQL_CONTAINER' did not exist, start the stack with: docker compose up -d"

cat <<EOF
==> Done.
The volume '$MYSQL_VOLUME' now uses the credentials from '$ENV_FILE'.
Verify the app user can connect with:
  docker exec -i $MYSQL_CONTAINER mysql -u$APP_USER -p -e "SHOW TABLES" $APP_DATABASE
EOF
