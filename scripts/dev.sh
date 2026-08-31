#!/usr/bin/env bash
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

COMPOSE_ENV_FILE='docker/compose.env'
COMPOSE_FILE='docker/compose.dev.yml'
ENV_FILE='.env'
BUILD_TSCONFIG='tsconfig.build.json'
PRISMA_CLIENT_DIR='src/platform/prisma/generated'

HEALTH_TIMEOUT_SECONDS=180
HEALTH_POLL_SECONDS=2
FIRST_EMIT_TIMEOUT_SECONDS=180
SHUTDOWN_GRACE_SECONDS=5

TSC_PID=''
NODEMON_PID=''

usage() {
  cat <<'USAGE'
usage: bash scripts/dev.sh <all|api|worker|scheduler>

  all        every role in one process — one compiler, one reload, one log
  api        HTTP surface, Better Auth mount, probes and /metrics
  worker     queue consumers
  scheduler  outbox drain and cron

Starts the dev infrastructure, waits for it to report healthy, then runs
`tsc --watch` and `nodemon` against dist/main.<role>.js.

`all` is the one to reach for while developing: running api, worker and
scheduler in three terminals means three compilers watching the same files and
writing the same dist/, which costs three times the CPU and makes each of them
restart on output the others produced.

Equivalent package scripts:
  pnpm dev:all | pnpm dev | pnpm dev:worker | pnpm dev:scheduler
USAGE
}

die() {
  printf 'dev: %s\n' "$1" >&2
  exit 1
}

info() { printf 'dev: %s\n' "$1"; }

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

ROLE=$1

case "$ROLE" in
  all | api | worker | scheduler) ;;
 *)
    printf 'dev: unknown role "%s".\n\n' "$ROLE" >&2
    usage >&2
    exit 1
    ;;
esac

ENTRYPOINT="dist/main.$ROLE.js"

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

stop_child() {
  pid=$1
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0

  kill -TERM "$pid" 2>/dev/null
  waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$SHUTDOWN_GRACE_SECONDS" ]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null
  fi
}

cleanup() {
  status=$?
  trap - INT TERM EXIT

  stop_child "$NODEMON_PID"
  stop_child "$TSC_PID"

  exit "$status"
}

trap cleanup INT TERM EXIT

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Run: cp .env.example $ENV_FILE && pnpm doctor"
command -v docker >/dev/null 2>&1 || die 'docker is not on PATH.'
docker info >/dev/null 2>&1 || die 'the docker daemon is not reachable — start Docker Desktop and retry.'

info 'starting dev infrastructure...'
compose up -d || die 'docker compose up failed.'

SERVICES=$(compose config --services) || die 'could not read the compose service list.'

container_id_of() {
  compose ps -a -q "$1" 2>/dev/null | head -1
}

STATE_TEMPLATE='{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else if eq .State.ExitCode 0}}done{{else}}exit-{{.State.ExitCode}}{{end}}'

info 'waiting for infrastructure to report healthy...'
deadline=$(($(date +%s) + HEALTH_TIMEOUT_SECONDS))
last_report=''

while :; do
  pending=''

  for service in $SERVICES; do
    cid=$(container_id_of "$service")

    if [ -z "$cid" ]; then
      pending="$pending $service(no-container)"
      continue
    fi

    state=$(docker inspect -f "$STATE_TEMPLATE" "$cid" 2>/dev/null)

    case "$state" in
      healthy | running | done) ;;
 *) pending="$pending $service(${state:-unknown})";;
    esac
  done

  [ -n "$pending" ] || break

  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf 'dev: infrastructure did not become healthy within %ss:%s\n' \
      "$HEALTH_TIMEOUT_SECONDS" "$pending" >&2
    printf 'dev: inspect it with: pnpm infra:logs\n' >&2
    exit 1
  fi

  if [ "$pending" != "$last_report" ]; then
    printf 'dev: waiting for%s\n' "$pending"
    last_report=$pending
  fi

  sleep "$HEALTH_POLL_SECONDS"
done

info 'infrastructure healthy.'

if [ ! -d "$PRISMA_CLIENT_DIR" ]; then
  info 'generating the Prisma client (first run)...'
  pnpm exec prisma generate || die 'prisma generate failed.'
fi

if ! pnpm exec prisma migrate status >/dev/null 2>&1; then
  info 'warning: the database is not at the latest migration (or is unreachable). Run: pnpm db:migrate'
fi

TSC_BIN=$(node --input-type=module -e \
  "import getExePath from './node_modules/@typescript/native/lib/getExePath.js'; process.stdout.write(getExePath());" \
  2>/dev/null)

if [ -z "$TSC_BIN" ]; then
  TSC_BIN='node_modules/.bin/tsc'
  [ -x "$TSC_BIN" ] || die 'no TypeScript compiler found — run: pnpm install'
fi

info "compiling ($BUILD_TSCONFIG, watch)..."
"$TSC_BIN" -p "$BUILD_TSCONFIG" --watch --preserveWatchOutput &
TSC_PID=$!

deadline=$(($(date +%s) + FIRST_EMIT_TIMEOUT_SECONDS))

while [ ! -f "$ENTRYPOINT" ]; do
  kill -0 "$TSC_PID" 2>/dev/null || die 'the compiler exited before emitting anything.'

  if [ "$(date +%s)" -ge "$deadline" ]; then
    die "$ENTRYPOINT was not emitted within ${FIRST_EMIT_TIMEOUT_SECONDS}s — check the compiler output above."
  fi

  sleep 1
done

info "starting $ENTRYPOINT (nodemon)..."
node_modules/.bin/nodemon \
  --watch dist \
  --ext js \
  --delay 300ms \
  --exec "node --env-file=$ENV_FILE $ENTRYPOINT" &
NODEMON_PID=$!

while kill -0 "$TSC_PID" 2>/dev/null && kill -0 "$NODEMON_PID" 2>/dev/null; do
  sleep 1
done

if kill -0 "$TSC_PID" 2>/dev/null; then
  printf 'dev: nodemon exited; stopping the compiler.\n' >&2
else
  printf 'dev: the compiler exited; stopping nodemon.\n' >&2
fi

exit 1
