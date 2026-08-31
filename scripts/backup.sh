#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

PG_IMAGE=${PG_IMAGE:-postgres:18-alpine}
BACKUP_DIR=${BACKUP_DIR:-./backups}
RETAIN=${BACKUP_RETAIN:-14}

usage() {
  cat <<'USAGE'
usage: bash scripts/backup.sh <dump|restore|verify> [file]

  dump             pg_dump the database in DATABASE_URL to $BACKUP_DIR
  restore <file>   restore a dump into DATABASE_URL
  verify <file>    restore into a throwaway container and run migrate deploy

env:
  DATABASE_URL     required
  BACKUP_DIR       default ./backups
  BACKUP_RETAIN    dumps to keep, default 14
  PG_IMAGE         default postgres:18-alpine
USAGE
}

die() {
  printf 'backup: %s\n' "$1" >&2
  exit 1
}

require_url() {
  [ -n "${DATABASE_URL:-}" ] || die 'DATABASE_URL is required'
}

validate_backup_file() {
  local file=$1

  case "$file" in
    app-*.dump) ;;
    *) die 'backup file must be an app-*.dump basename' ;;
  esac

  case "$file" in
    */*|*\\*|*..*) die 'backup file must not contain a path' ;;
  esac
}

validate_retain() {
  case "$RETAIN" in
    ''|*[!0-9]*) die 'BACKUP_RETAIN must be a non-negative integer' ;;
  esac
}

run_pg() {
  MSYS_NO_PATHCONV=1 docker run --rm --network host -e PGPASSWORD -v "$ROOT/$BACKUP_DIR:/backups" "$PG_IMAGE" "$@"
}

stamp_from() {
  docker run --rm "$PG_IMAGE" date -u +%Y%m%dT%H%M%SZ
}

do_dump() {
  require_url
  validate_retain
  mkdir -p "$BACKUP_DIR"

  local stamp file
  stamp=$(stamp_from)
  file="app-$stamp.dump"

  run_pg pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 \
    --no-owner --no-privileges --file="/backups/$file"

  printf 'wrote %s/%s (%s)\n' "$BACKUP_DIR" "$file" "$(du -h "$BACKUP_DIR/$file" | cut -f1)"

  local removed=0
  while IFS= read -r stale; do
    rm -f "$stale"
    removed=$((removed + 1))
  done < <(ls -1t "$BACKUP_DIR"/app-*.dump 2>/dev/null | tail -n "+$((RETAIN + 1))")

  [ "$removed" -eq 0 ] || printf 'pruned %s dump(s) beyond the last %s\n' "$removed" "$RETAIN"
}

do_restore() {
  require_url
  local file=$1
  validate_backup_file "$file"
  [ -f "$BACKUP_DIR/$file" ] || die "$BACKUP_DIR/$file does not exist"

  printf 'This OVERWRITES the database in DATABASE_URL. Type the file name to confirm: '
  local answer
  read -r answer
  [ "$answer" = "$file" ] || die 'aborted'

  run_pg pg_restore --dbname="$DATABASE_URL" --clean --if-exists \
    --no-owner --no-privileges "/backups/$file"

  printf 'restored %s\n' "$file"
}

VERIFY_CONTAINER=''

cleanup_verify() {
  [ -z "$VERIFY_CONTAINER" ] || docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
}

do_verify() {
  local file=$1
  validate_backup_file "$file"
  local port=${VERIFY_PORT:-55432}
  [ -f "$BACKUP_DIR/$file" ] || die "$BACKUP_DIR/$file does not exist"

  VERIFY_CONTAINER="backup-verify-$$"
  trap cleanup_verify EXIT INT TERM

  docker run -d --name "$VERIFY_CONTAINER" -p "$port:5432" \
    -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify \
    --health-cmd 'pg_isready -U verify -d verify' --health-interval 2s --health-retries 30 \
    "$PG_IMAGE" >/dev/null

  local waited=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$VERIFY_CONTAINER")" = 'healthy' ]; do
    sleep 2
    waited=$((waited + 2))
    [ "$waited" -lt 120 ] || die 'the throwaway database never became healthy'
  done

  local url="postgresql://verify:verify@localhost:$port/verify"

  MSYS_NO_PATHCONV=1 docker run --rm --network host -v "$ROOT/$BACKUP_DIR:/backups" "$PG_IMAGE" \
    pg_restore --dbname="$url" --no-owner --no-privileges "/backups/$file"

  DATABASE_URL="$url" DATABASE_DIRECT_URL='' pnpm exec prisma migrate deploy

  printf '\n%s restores cleanly and the migration history applies on top of it.\n' "$file"
}

case "${1:-}" in
  dump) do_dump ;;
  restore) do_restore "${2:?usage: bash scripts/backup.sh restore <file>}" ;;
  verify) do_verify "${2:?usage: bash scripts/backup.sh verify <file>}" ;;
  *)
    usage
    exit 1
    ;;
esac
