#!/usr/bin/env bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

COUNT=${1:-2000}

case "$COUNT" in
  '' | *[!0-9]*)
    printf 'bench:outbox: event count must be a positive integer, got "%s".\n' "$COUNT" >&2
    exit 1
    ;;
esac

printf 'bench:outbox: draining %s synthetic events through the real relay (testcontainers).\n' "$COUNT"

OUTBOX_BENCH=1 OUTBOX_BENCH_EVENTS="$COUNT" \
  pnpm vitest run --project integration src/platform/messaging/outbox-drain.bench.integration.ts
