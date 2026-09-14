#!/usr/bin/env bash
# Production preflight: fail fast when the deployment environment is unsafe.
#
# The goal is to catch the misconfigurations that are silent at runtime:
# a short JWT secret, verbose errors leaking internals to the public, a
# plaintext (non-Secure) auth cookie, wildcard CORS, a default admin account
# still seeded, or a MySQL volume whose password can no longer be applied.
#
# Usage:
#   scripts/preflight-env.sh [env-file]        # default: .env
#
# Exit code 0 = safe to deploy (warnings may still be printed),
#           1 = at least one blocking problem.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"

ENV_FILE="${1:-.env}"
FAILURES=0
WARNINGS=0

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file '$ENV_FILE' not found" >&2
  exit 1
fi

fail() {
  FAILURES=$((FAILURES + 1))
  printf '  [FAIL] %s\n' "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '  [WARN] %s\n' "$1"
}

pass() {
  printf '  [ ok ] %s\n' "$1"
}

is_weak() {
  local lowered
  lowered="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    ""|root|password|passwd|changeme|change-me|secret|admin|admin123|vibocnc|fanuc|123456|12345678|default|test|example) return 0 ;;
  esac
  return 1
}

echo "Preflight for $ENV_FILE"

echo "Secrets"
jwt_secret="$(env_file_value "$ENV_FILE" JWT_SECRET)"
if [[ ${#jwt_secret} -lt 32 ]]; then
  fail "JWT_SECRET must be at least 32 characters (currently ${#jwt_secret})"
elif is_weak "$jwt_secret"; then
  fail "JWT_SECRET looks like a placeholder value"
else
  pass "JWT_SECRET length is acceptable"
fi

encryption_key="$(env_file_value "$ENV_FILE" SETTINGS_ENCRYPTION_KEY)"
if [[ -z "$encryption_key" ]]; then
  fail "SETTINGS_ENCRYPTION_KEY is required to encrypt PayPal/AI credentials at rest"
elif is_weak "$encryption_key"; then
  fail "SETTINGS_ENCRYPTION_KEY looks like a placeholder value"
else
  pass "SETTINGS_ENCRYPTION_KEY is set"
fi

revalidate_secret="$(env_file_value "$ENV_FILE" REVALIDATE_SECRET)"
if [[ -z "$revalidate_secret" ]]; then
  fail "REVALIDATE_SECRET is required; the ISR webhook is unauthenticated without it"
else
  pass "REVALIDATE_SECRET is set"
fi

echo "Database"
mysql_password="$(env_file_value "$ENV_FILE" MYSQL_PASSWORD)"
mysql_root_password="$(env_file_value "$ENV_FILE" MYSQL_ROOT_PASSWORD)"
if is_weak "$mysql_password"; then
  fail "MYSQL_PASSWORD is empty or a well-known default"
else
  pass "MYSQL_PASSWORD is set"
fi
if is_weak "$mysql_root_password"; then
  fail "MYSQL_ROOT_PASSWORD is empty or a well-known default"
else
  pass "MYSQL_ROOT_PASSWORD is set"
fi
if [[ -n "$mysql_password" && "$mysql_password" == "$jwt_secret" ]]; then
  fail "MYSQL_PASSWORD must not reuse JWT_SECRET"
fi
if [[ "$(env_file_value "$ENV_FILE" DB_AUTO_MIGRATE)" == "true" ]]; then
  warn "DB_AUTO_MIGRATE=true runs schema changes on every boot; keep it true for the first deployment, then set it to false and apply migrations deliberately"
fi

echo "Auth cookies and errors"
if [[ "$(env_file_value "$ENV_FILE" AUTH_COOKIE_SECURE)" != "true" ]]; then
  fail "AUTH_COOKIE_SECURE=true is required when the site is served over HTTPS (otherwise the admin session cookie is sent in clear text)"
else
  pass "AUTH_COOKIE_SECURE=true"
fi
if [[ "$(env_file_value "$ENV_FILE" API_VERBOSE_ERRORS)" == "true" ]]; then
  fail "API_VERBOSE_ERRORS must be false in production; it returns internal error details to clients"
else
  pass "API_VERBOSE_ERRORS is not enabled"
fi
if [[ "$(env_file_value "$ENV_FILE" SEED_DEFAULT_ADMIN)" == "true" ]]; then
  warn "SEED_DEFAULT_ADMIN=true; set it to false once the initial admin account exists"
elif [[ "$(env_file_value "$ENV_FILE" RESET_DEFAULT_ADMIN_PASSWORD)" == "true" ]]; then
  fail "RESET_DEFAULT_ADMIN_PASSWORD=true would reset the admin password back to DEFAULT_ADMIN_PASSWORD on every boot"
else
  pass "default admin seeding is off"
fi
if is_weak "$(env_file_value "$ENV_FILE" DEFAULT_ADMIN_PASSWORD)" && [[ "$(env_file_value "$ENV_FILE" SEED_DEFAULT_ADMIN)" == "true" ]]; then
  fail "DEFAULT_ADMIN_PASSWORD is a well-known default and SEED_DEFAULT_ADMIN is on"
fi

echo "Network trust"
trusted_proxies="$(env_file_value "$ENV_FILE" TRUSTED_PROXIES)"
if [[ -z "$trusted_proxies" ]]; then
  warn "TRUSTED_PROXIES is unset: the backend trusts loopback plus every RFC1918 address, so any host on the docker/private network can spoof X-Forwarded-For and X-Forwarded-Proto. Set it to the proxy address(es), e.g. 127.0.0.1,::1 for a host-local Nginx."
elif [[ "$trusted_proxies" == *"0.0.0.0/0"* || "$trusted_proxies" == *"::/0"* ]]; then
  fail "TRUSTED_PROXIES must not trust every address"
else
  pass "TRUSTED_PROXIES is explicit ($trusted_proxies)"
fi

cors_origins="$(env_file_value "$ENV_FILE" CORS_ORIGINS)"
if [[ -z "$cors_origins" ]]; then
  fail "CORS_ORIGINS is empty; set the exact site origin(s)"
elif [[ "$cors_origins" == *"*"* ]]; then
  fail "CORS_ORIGINS must not contain a wildcard"
else
  pass "CORS_ORIGINS is explicit"
fi
if [[ "$(env_file_value "$ENV_FILE" CORS_ALLOW_CHROME_EXTENSIONS)" == "true" && -z "$(env_file_value "$ENV_FILE" CORS_EXTENSION_ORIGINS)" ]]; then
  fail "CORS_ALLOW_CHROME_EXTENSIONS=true without CORS_EXTENSION_ORIGINS accepts any extension origin"
else
  pass "extension CORS is not wide open"
fi

echo "Operational"
if [[ -z "$(env_file_value "$ENV_FILE" REDIS_ADDR)" ]]; then
  warn "REDIS_ADDR is unset: rate limiting and the response cache fall back to per-process memory, which stops working correctly with more than one backend replica"
else
  pass "REDIS_ADDR is set"
fi
if [[ "$(env_file_value "$ENV_FILE" PRODUCT_SEARCH_MODE)" == "fulltext" ]]; then
  warn "PRODUCT_SEARCH_MODE=fulltext: confirm migrations/20260910_add_product_search_fulltext.sql has been applied"
fi
if [[ "$(env_file_value "$ENV_FILE" AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES)" == "true" ]]; then
  warn "AI_PROVIDER_ALLOW_PRIVATE_ADDRESSES=true: AI provider requests may reach private addresses and arbitrary ports; confirm the configured base URL is trusted"
fi
min_confidence="$(env_file_value "$ENV_FILE" AI_CLASSIFICATION_MIN_CONFIDENCE)"
if [[ -n "$min_confidence" ]] && ! awk -v value="$min_confidence" 'BEGIN { exit !(value + 0 > 0 && value + 0 <= 1) }' </dev/null; then
  fail "AI_CLASSIFICATION_MIN_CONFIDENCE must be a number within (0, 1] (got '$min_confidence')"
fi

echo
if [[ $FAILURES -gt 0 ]]; then
  printf '%d blocking problem(s), %d warning(s)\n' "$FAILURES" "$WARNINGS"
  exit 1
fi
printf 'No blocking problems, %d warning(s)\n' "$WARNINGS"
