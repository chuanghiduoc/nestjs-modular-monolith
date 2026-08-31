#!/usr/bin/env bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

TEMPLATE_ROOT='scripts/templates/module'
MODULES_DIR='src/modules'
DEFAULT_TIER=1

RESERVED_NAMES='shared common utils core'

die() {
  printf 'gen:module: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
usage: bash scripts/gen-module.sh <name> [--tier 1|2]

  <name>        kebab-case, named after the PRODUCT CAPABILITY: billing,
                catalog, notifications — not core, common, shared or utils.
  --tier 1      simple context: no invariants, so no entity (default)
  --tier 2      rich context: aggregate root, value object, domain events

Example: pnpm gen:module billing --tier 2
USAGE
}

NAME=''
TIER=$DEFAULT_TIER

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --tier)
      [ "$#" -ge 2 ] || die '--tier needs a value (1 or 2).'
      TIER=$2
      shift 2
      ;;
    --tier=*)
      TIER=${1#--tier=}
      shift
      ;;
    -*)
      printf 'gen:module: unknown option "%s".\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
 *)
      [ -z "$NAME" ] || die "unexpected extra argument \"$1\"."
      NAME=$1
      shift
      ;;
  esac
done

if [ -z "$NAME" ]; then
  usage >&2
  exit 1
fi

case "$TIER" in
  1 | 2) ;;
 *) die "unknown tier \"$TIER\" — expected 1 or 2.";;
esac

if ! printf '%s' "$NAME" | grep -q -E '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'; then
  die "\"$NAME\" is not kebab-case — use lowercase words separated by single hyphens."
fi

for reserved in $RESERVED_NAMES; do
  if [ "$NAME" = "$reserved" ]; then
    die "\"$NAME\" is forbidden as a context name: a context named after what it is NOT about absorbs everything nobody wanted to place. Name it after the product capability."
  fi
done

TARGET_DIR="$MODULES_DIR/$NAME"
[ ! -e "$TARGET_DIR" ] || die "$TARGET_DIR already exists."

TEMPLATE_DIR="$TEMPLATE_ROOT/tier$TIER"
[ -d "$TEMPLATE_DIR" ] || die "template directory $TEMPLATE_DIR is missing."

to_pascal() {
  printf '%s' "$1" | awk -F- '{ out = ""; for (i = 1; i <= NF; i++) out = out toupper(substr($i, 1, 1)) substr($i, 2); print out }'
}

KEBAB=$NAME
PASCAL=$(to_pascal "$NAME")
CAMEL=$(printf '%s%s' \
  "$(printf '%s' "$PASCAL" | cut -c1 | tr 'A-Z' 'a-z')" \
  "$(printf '%s' "$PASCAL" | cut -c2-)")
SCREAM=$(printf '%s' "$NAME" | tr 'a-z-' 'A-Z_')

FILE_LIST=$(mktemp 2>/dev/null || mktemp -t genmodule)
GENERATED=0

discard_partial_output() {
  rm -f "$FILE_LIST"
  if [ "$GENERATED" -eq 0 ] && [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
  fi
}

trap discard_partial_output EXIT
trap 'discard_partial_output; exit 130' INT TERM

find "$TEMPLATE_DIR" -type f -name '*.tpl' | sort >"$FILE_LIST"
[ -s "$FILE_LIST" ] || die "no templates found under $TEMPLATE_DIR."

printf 'gen:module: %s (tier %s)\n' "$NAME" "$TIER"

rename_placeholders() {
  sed -e "s/__MODULE_KEBAB__/$KEBAB/g" \
    -e "s/__MODULE_PASCAL__/$PASCAL/g" \
    -e "s/__MODULE_CAMEL__/$CAMEL/g" \
    -e "s/__MODULE_SCREAM__/$SCREAM/g"
}

while IFS= read -r template; do
  [ -n "$template" ] || continue

  relative=${template#"$TEMPLATE_DIR/"}
  destination="$TARGET_DIR/$(printf '%s' "${relative%.tpl}" | rename_placeholders)"

  mkdir -p "$(dirname "$destination")"
  rename_placeholders <"$template" >"$destination"

  printf '  + %s\n' "$destination"
done <"$FILE_LIST"

GENERATED=1

cat <<MANUAL

Two manual steps remain. Both are decisions, not boilerplate:

  1. Register ${PASCAL}Module with the roles that need it.
     A context is wired by an explicit import, so which processes run it stays
     reviewable in one file per role:

       src/bootstrap/api.module.ts        — it exposes HTTP endpoints
       src/bootstrap/worker.module.ts     — it consumes queue jobs
       src/bootstrap/scheduler.module.ts  — it runs scheduled work

       import { ${PASCAL}Module } from '#modules/${KEBAB}';
 //... imports: [..., ${PASCAL}Module ]

  2. Declare the table in prisma/models/${KEBAB}.prisma, then: pnpm db:migrate
     One Postgres schema per context, and no cross-context foreign
     keys. Until the model exists, Prisma${PASCAL}Repository throws on every
     call — a scaffold that returned an empty array instead would read as
     "no rows" and be found much later.

Then: pnpm typecheck && pnpm boundaries && pnpm lint

Tenant safety check: the scaffold is intentionally neutral, so decide before
registering it whether the capability is global or customer-owned. For
customer-owned data, add organizationId to the aggregate, commands, repository
queries and database foreign keys, decorate HTTP controllers with TenantRequired,
and document the x-organization-id header in OpenAPI. Never rely on ownerId alone
for tenant isolation.
MANUAL
