#!/usr/bin/env bash
# Read a key from a .env file WITHOUT executing it (values must never be
# interpreted by the shell) and without leaking them into the process list.
#
# Sourced by the other scripts in this directory:
#   source "$(dirname "$0")/lib-env.sh"
#   value="$(env_file_value .env JWT_SECRET)"
#
# Notes:
# - CRLF line endings are tolerated.
# - Surrounding single or double quotes are stripped.
# - The last occurrence of a key wins, matching docker compose behaviour.
env_file_value() {
  local file="$1" key="$2" line name value out cr
  cr=$'\r'
  out=""
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$cr}"
    case "$line" in
      '' | '#'*) continue ;;
    esac
    name="${line%%=*}"
    [[ "$name" == "$line" ]] && continue
    # Trim spaces around the key.
    name="${name#"${name%%[![:space:]]*}"}"
    name="${name%"${name##*[![:space:]]}"}"
    [[ "$name" == "$key" ]] || continue
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    out="$value"
  done <"$file"
  printf '%s' "$out"
}

# Escape a value for use as a MySQL string literal (backslash is an escape
# character unless NO_BACKSLASH_ESCAPES is set, so it must be doubled first).
env_sql_quote() {
  local escaped
  escaped="$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")"
  printf "'%s'" "$escaped"
}

# Escape a value for use as a MySQL identifier (schema/table name). Identifiers
# need backticks, not string quotes, and an embedded backtick is doubled.
env_sql_identifier() {
  local escaped
  escaped="$(printf '%s' "$1" | sed -e 's/`/``/g')"
  printf '`%s`' "$escaped"
}
