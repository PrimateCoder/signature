#!/usr/bin/env bash
# PianoTell Flarum UX-test harness. Idempotent end-to-end runner:
#   1. Verifies the dev container is running.
#   2. Provisions test users via Flarum's own bootstrap (no DB secrets).
#   3. Installs Playwright into this dir on first use.
#   4. Runs the spec passed as $1, forwarding its exit code.
#
# Usage:
#   .pianotell/tests/ux/run.sh path/to/spec.mjs
#
# Configuration (all optional):
#   PIANOTELL_FLARUM_UX_CONTAINER     docker container         (default: pianotell-web)
#   PIANOTELL_FLARUM_UX_BASE_URL      forum origin             (default: https://localhost/)
#   PIANOTELL_FLARUM_UX_FLARUM_PATH   flarum dir in container  (default: /var/www/html)
#   PIANOTELL_FLARUM_UX_PHP_USER      docker exec -u value     (default: docker)
#   PIANOTELL_FLARUM_UX_USERS         JSON user spec           (default: single pianotell user)
#
# Spec receives via env:
#   PIANOTELL_FLARUM_UX_BASE_URL  — same value
#   PIANOTELL_FLARUM_UX_COOKIE    — bare cookie value (only when single user)
# Multi-user specs should parse the harness's own COOKIE <username>=<token>
# stderr (or call the provisioner directly).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  printf 'usage: %s <spec.mjs>\n' "$0" >&2
  exit 2
fi
SPEC="$1"
[[ -f "$SPEC" ]] || { printf '[harness] spec not found: %s\n' "$SPEC" >&2; exit 2; }
SPEC_ABS="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${PIANOTELL_FLARUM_UX_CONTAINER:-pianotell-web}"
BASE_URL="${PIANOTELL_FLARUM_UX_BASE_URL:-https://localhost/}"
FLARUM_DIR="${PIANOTELL_FLARUM_UX_FLARUM_PATH:-/var/www/html}"
PHP_USER="${PIANOTELL_FLARUM_UX_PHP_USER:-docker}"

log() { printf '[harness] %s\n' "$*" >&2; }
die() { printf '[harness] error: %s\n' "$*" >&2; exit 1; }

# 1. Container check
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  die "container '$CONTAINER' is not running. Start it (or set PIANOTELL_FLARUM_UX_CONTAINER)."
fi
log "container '$CONTAINER' is up"

# 2. Provision test user(s).
PROVISION_SCRIPT="$HERE/provision-test-user.php"
[[ -f "$PROVISION_SCRIPT" ]] || die "missing $PROVISION_SCRIPT"

CONTAINER_TMP="/tmp/pianotell-flarum-ux-provision.php"
docker cp "$PROVISION_SCRIPT" "$CONTAINER:$CONTAINER_TMP" >/dev/null

DOCKER_ENV_ARGS=(
  -e "PIANOTELL_FLARUM_UX_FLARUM_PATH=$FLARUM_DIR"
)
if [[ -n "${PIANOTELL_FLARUM_UX_USERS:-}" ]]; then
  DOCKER_ENV_ARGS+=(-e "PIANOTELL_FLARUM_UX_USERS=$PIANOTELL_FLARUM_UX_USERS")
fi

PROVISION_OUT="$(
  docker exec -i -u "$PHP_USER" \
    "${DOCKER_ENV_ARGS[@]}" \
    "$CONTAINER" php "$CONTAINER_TMP"
)" || die "provisioning script failed inside container (see stderr above)"

docker exec "$CONTAINER" rm -f "$CONTAINER_TMP" >/dev/null || true

COOKIE_LINE="$(printf '%s\n' "$PROVISION_OUT" | grep -E '^COOKIE=' || true)"
[[ -n "$COOKIE_LINE" ]] || die "provisioner did not emit COOKIE=<value> (multi-user mode? specs should parse 'COOKIE <user>=<tok>' lines themselves)"
COOKIE_VALUE="${COOKIE_LINE#COOKIE=}"
[[ -n "$COOKIE_VALUE" ]] || die "empty cookie value from provisioner"
log "test user provisioned; cookie length=${#COOKIE_VALUE}"

# 3. Playwright install (one-time).
if [[ ! -e "$HERE/node_modules" ]]; then
  if [[ -d "/tmp/pw/node_modules/playwright" ]]; then
    log "linking Playwright from /tmp/pw/node_modules"
    ln -sfn /tmp/pw/node_modules "$HERE/node_modules"
  else
    log "installing Playwright (one-time, ~50MB)"
    (cd "$HERE" && npm install --silent)
    (cd "$HERE" && npx playwright install --with-deps chromium >/dev/null) \
      || log "warning: 'playwright install' returned non-zero; tests may fail to launch a browser"
  fi
fi

# 4. Make the harness's node_modules visible to the spec.
#    Node ESM bare-import resolution walks up from the spec file looking
#    for node_modules/<pkg>; if the spec lives outside the harness dir
#    (it usually does), we drop a symlink next to it. The symlink is
#    expected to be gitignored in the consuming extension.
SPEC_DIR="$(dirname "$SPEC_ABS")"
if [[ "$SPEC_DIR" != "$HERE" && ! -e "$SPEC_DIR/node_modules" ]]; then
  ln -sfn "$HERE/node_modules" "$SPEC_DIR/node_modules"
  log "linked $SPEC_DIR/node_modules -> harness node_modules"
fi

# 5. Run the spec.
export PIANOTELL_FLARUM_UX_BASE_URL="$BASE_URL"
export PIANOTELL_FLARUM_UX_COOKIE="$COOKIE_VALUE"
log "running $(basename "$SPEC_ABS") against $BASE_URL"

cd "$SPEC_DIR"
exec node "$SPEC_ABS"
