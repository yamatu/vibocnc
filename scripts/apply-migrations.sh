#!/usr/bin/env bash
# Apply pending SQL migrations from backend/migrations/ to the Docker MySQL.
#
# Each *.sql file (top level only, applied in filename order) runs once and is
# then recorded in the schema_migrations table, so the script can be run on
# every deploy. The record is written in the same mysql session right after
# the file's last statement, so a failing file is never marked as applied.
# Files must be idempotent (guard ALTERs through information_schema): MySQL
# DDL auto-commits, so a file that fails halfway is simply re-run after the fix.
# Files under backend/migrations/optional/ are never applied automatically.
#
# Usage:
#   scripts/apply-migrations.sh              # apply pending migrations
#   scripts/apply-migrations.sh --status     # list applied / pending files
#   scripts/apply-migrations.sh --dry-run    # list what would be applied
#
# Overridable via environment:
#   COMPOSE         compose command (default: auto-detect, see lib-compose.sh)
#   MYSQL_SERVICE   compose service running MySQL (default: mysql)
#   MIGRATIONS_DIR  directory with *.sql files (default: backend/migrations)
#
# SQL runs inside the MySQL container as root, using the MYSQL_ROOT_PASSWORD and
# MYSQL_DATABASE already set on that container, so no secret appears in the
# host process list.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=lib-compose.sh
source "$SCRIPT_DIR/lib-compose.sh"

MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-backend/migrations}"
MODE=apply

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  "" | --apply) ;;
  --status) MODE=status ;;
  --dry-run) MODE=dry-run ;;
  -h | --help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

die() { echo "error: $*" >&2; exit 1; }

resolve_compose_cmd || exit 1
[[ -d "$MIGRATIONS_DIR" ]] || die "migrations directory '$MIGRATIONS_DIR' not found"

# stdin -> mysql client inside the container, connected to the app database.
mysql_exec() {
  "${COMPOSE_CMD[@]}" exec -T "$MYSQL_SERVICE" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot "$@" "$MYSQL_DATABASE"' \
    mysql "$@"
}
mysql_query() { mysql_exec -N -B -e "$1"; }

sha256_of() {
  # Strip CR so a Windows checkout and a Linux checkout produce the same checksum.
  if command -v sha256sum >/dev/null 2>&1; then
    tr -d '\r' <"$1" | sha256sum | cut -d' ' -f1
  else
    tr -d '\r' <"$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

if [[ -z "$("${COMPOSE_CMD[@]}" ps -q "$MYSQL_SERVICE" 2>/dev/null)" ]]; then
  die "the '$MYSQL_SERVICE' service is not running; start it first: ${COMPOSE_CMD[*]} up -d $MYSQL_SERVICE"
fi

echo "==> Waiting for MySQL to accept connections"
ready=0
for _ in $(seq 1 60); do
  if mysql_query "SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == 1 ]] || die "MySQL did not become ready within 120s (check: ${COMPOSE_CMD[*]} logs $MYSQL_SERVICE)"

has_table() {
  [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$1'")" != "0" ]]
}

# Migrations alter tables that the backend's AutoMigrate creates. On an empty
# database there is nothing to migrate yet.
if ! has_table products; then
  echo "note: the database has no base tables yet (fresh install)."
  echo "      Start the backend once with DB_AUTO_MIGRATE=true to create them; migrations are not needed for that."
  exit 0
fi

if [[ "$MODE" == apply ]]; then
  mysql_query "CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL,
    execution_ms INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci" >/dev/null
fi

declare -A applied=()
if has_table schema_migrations; then
  while IFS=$'\t' read -r name sum; do
    [[ -n "$name" ]] && applied["$name"]="$sum"
  done < <(mysql_query "SELECT filename, checksum FROM schema_migrations")
fi

pending=()
while IFS= read -r file; do
  name="$(basename "$file")"
  [[ "$name" =~ ^[A-Za-z0-9_.-]+\.sql$ ]] || die "unsupported migration file name: $name (use letters, digits, '_', '-', '.')"
  if grep -Eiq '^[[:space:]]*USE[[:space:]]' "$file"; then
    die "$name contains a USE statement; migrations must run against the configured database"
  fi
  last_line="$(tr -d '\r' <"$file" | grep -Ev '^[[:space:]]*(--.*)?$' | tail -n 1)"
  [[ "$last_line" =~ \;[[:space:]]*$ ]] || die "$name must end with a ';'-terminated statement"

  sum="$(sha256_of "$file")"
  if [[ -n "${applied[$name]:-}" ]]; then
    if [[ "$MODE" == status ]]; then
      if [[ "${applied[$name]}" == "$sum" ]]; then
        echo "  applied   $name"
      else
        echo "  applied   $name  (file changed since it was applied; it is not re-run)"
      fi
    elif [[ "${applied[$name]}" != "$sum" ]]; then
      echo "warning: $name changed after it was applied; it is not re-run. Put new changes in a new migration file." >&2
    fi
    continue
  fi
  [[ "$MODE" == status ]] && echo "  pending   $name"
  pending+=("$file")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)

if [[ "$MODE" == status ]]; then
  echo "${#pending[@]} pending migration(s)."
  exit 0
fi
if [[ ${#pending[@]} -eq 0 ]]; then
  echo "==> Database schema is up to date (no pending migrations)"
  exit 0
fi
if [[ "$MODE" == dry-run ]]; then
  echo "Would apply ${#pending[@]} migration(s):"
  printf '  %s\n' "${pending[@]##*/}"
  exit 0
fi

echo "==> Applying ${#pending[@]} migration(s)"
output="$(mktemp)"
trap 'rm -f "$output"' EXIT
for file in "${pending[@]}"; do
  name="$(basename "$file")"
  sum="$(sha256_of "$file")"
  echo "  -> $name"
  # The INSERT is reached only when every statement in the file succeeded:
  # the mysql client stops at the first error (no --force).
  if ! {
    echo "SET @schema_migration_started = NOW(3);"
    tr -d '\r' <"$file"
    printf '\nDELIMITER ;\n'
    echo "INSERT INTO schema_migrations (filename, checksum, applied_at, execution_ms)"
    echo "VALUES ('$name', '$sum', NOW(3), TIMESTAMPDIFF(MICROSECOND, @schema_migration_started, NOW(3)) DIV 1000);"
  } | mysql_exec >"$output" 2>&1; then
    echo "error: migration $name failed:" >&2
    sed 's/^/     /' "$output" >&2
    echo "Nothing after $name was applied. Fix the file (it must stay idempotent) and run this script again;" >&2
    echo "migrations that already succeeded are skipped." >&2
    exit 1
  fi
done
echo "==> Applied ${#pending[@]} migration(s)"
