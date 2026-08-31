#!/usr/bin/env bash
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

CONFIG_GLOB='src/bootstrap/config/env.*.ts'
EXAMPLE_FILE='.env.example'
LOCAL_ENV_FILE='.env'
MIN_NODE_MAJOR=24

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t doctor)
trap 'rm -rf "$TMP_DIR"' EXIT
trap 'rm -rf "$TMP_DIR"; exit 130' INT TERM

failures=0
warnings=0

section() { printf '\n== %s ==\n' "$1"; }
ok() { printf '  [ ok ] %s\n' "$1"; }
warn() {
  printf '  [warn] %s\n' "$1"
  warnings=$((warnings + 1))
}
fail() {
  printf '  [FAIL] %s\n' "$1"
  failures=$((failures + 1))
}

section 'Toolchain'

if ! command -v node >/dev/null 2>&1; then
  fail 'node is not on PATH.'
else
  node_version=$(node --version | sed 's/^v//')
  node_major=$(printf '%s' "$node_version" | cut -d. -f1)
  if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
    fail "node $node_version is too old — this project requires >= $MIN_NODE_MAJOR."
  else
    ok "node $node_version"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  fail 'pnpm is not on PATH — corepack enable, or install it globally.'
else
  ok "pnpm $(pnpm --version)"
fi

section 'Environment contract (zod schema <-> .env.example)'

grep -h -E '^[[:space:]]+[A-Z][A-Z0-9_]*:[[:space:]]*[A-Za-z_$]' $CONFIG_GLOB 2>/dev/null |
  sed -e 's/^[[:space:]]*//' -e 's/:.*//' |
  sort -u >"$TMP_DIR/schema.keys"

grep -h -E '^[[:space:]]+[A-Z][A-Z0-9_]*:[[:space:]]*[A-Za-z_$]' $CONFIG_GLOB 2>/dev/null |
  grep -v -E '\.default\(|\.optional\(' |
  sed -e 's/^[[:space:]]*//' -e 's/:.*//' |
  sort -u >"$TMP_DIR/schema.required"

schema_count=$(wc -l <"$TMP_DIR/schema.keys" | tr -d ' ')

if [ "$schema_count" -eq 0 ]; then
  fail "no keys extracted from $CONFIG_GLOB — the extraction pattern in this script is stale."
elif [ ! -f "$EXAMPLE_FILE" ]; then
  fail "$EXAMPLE_FILE is missing — it is the environment contract, not a convenience."
else
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$EXAMPLE_FILE" |
    sed 's/=.*//' |
    sort -u >"$TMP_DIR/example.keys"

  drifted=0

  comm -23 "$TMP_DIR/schema.keys" "$TMP_DIR/example.keys" >"$TMP_DIR/only-in-schema"
  comm -13 "$TMP_DIR/schema.keys" "$TMP_DIR/example.keys" >"$TMP_DIR/only-in-example"

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    fail "$key is declared in the schema but missing from $EXAMPLE_FILE."
    drifted=1
  done <"$TMP_DIR/only-in-schema"

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    fail "$key is documented in $EXAMPLE_FILE but no longer exists in the schema."
    drifted=1
  done <"$TMP_DIR/only-in-example"

  if [ "$drifted" -eq 0 ]; then
    ok "$schema_count keys, no drift between the schema and $EXAMPLE_FILE"
  fi
fi

section "Local $LOCAL_ENV_FILE"

if [ ! -f "$LOCAL_ENV_FILE" ]; then
  warn "$LOCAL_ENV_FILE does not exist — run: cp $EXAMPLE_FILE $LOCAL_ENV_FILE"
elif [ ! -f "$TMP_DIR/example.keys" ]; then
  warn "skipped: $EXAMPLE_FILE could not be read."
else
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$LOCAL_ENV_FILE" |
    sed 's/=.*//' |
    sort -u >"$TMP_DIR/env.keys"

  comm -23 "$TMP_DIR/example.keys" "$TMP_DIR/env.keys" >"$TMP_DIR/missing-in-env"
  comm -13 "$TMP_DIR/example.keys" "$TMP_DIR/env.keys" >"$TMP_DIR/extra-in-env"

  env_problems=0

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    fail "$LOCAL_ENV_FILE is missing $key (documented in $EXAMPLE_FILE)."
    env_problems=$((env_problems + 1))
  done <"$TMP_DIR/missing-in-env"

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    warn "$LOCAL_ENV_FILE sets $key, which $EXAMPLE_FILE does not document."
  done <"$TMP_DIR/extra-in-env"

  while IFS= read -r key; do
    [ -n "$key" ] || continue
    value=$(grep -E "^$key=" "$LOCAL_ENV_FILE" | head -1 | sed "s/^$key=//")
    if [ -z "$value" ]; then
      fail "$LOCAL_ENV_FILE sets $key to an empty value, and the schema has no default for it — the role will exit non-zero at boot."
      env_problems=$((env_problems + 1))
    fi
  done <"$TMP_DIR/schema.required"

  if [ "$env_problems" -eq 0 ]; then
    ok "$LOCAL_ENV_FILE covers every documented key and every required value is set"
  fi
fi

section 'Infrastructure'

if ! command -v docker >/dev/null 2>&1; then
  warn 'docker is not on PATH — the dev stack (postgres, redis, minio, mailpit) cannot start.'
elif ! docker info >/dev/null 2>&1; then
  warn 'docker is installed but the daemon is not reachable — start Docker Desktop, then: pnpm infra:up'
else
  ok "docker $(docker --version | sed 's/^Docker version //; s/,.*//')"
fi

printf '\n'
if [ "$failures" -gt 0 ]; then
  printf 'doctor: %s failure(s), %s warning(s)\n' "$failures" "$warnings"
  exit 1
fi

printf 'doctor: ok (%s warning(s))\n' "$warnings"
