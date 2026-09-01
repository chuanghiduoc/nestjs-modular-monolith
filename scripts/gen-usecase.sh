#!/usr/bin/env bash
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

TEMPLATE_DIR='scripts/templates/usecase'
MODULES_DIR='src/modules'

die() {
  printf 'gen:usecase: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
usage: bash scripts/gen-usecase.sh <module> <action> [--query]

  <module>      an existing bounded context under src/modules
  <action>      kebab-case verb phrase: cancel-subscription, archive-report
  --query       read-side use case: no request DTO is generated

Example: pnpm gen:usecase billing cancel-subscription
USAGE
}

MODULE=''
ACTION=''
KIND='command'

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --query)
      KIND='query'
      shift
      ;;
    -*)
      printf 'gen:usecase: unknown option "%s".\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -z "$MODULE" ]; then
        MODULE=$1
      elif [ -z "$ACTION" ]; then
        ACTION=$1
      else
        die "unexpected extra argument \"$1\"."
      fi
      shift
      ;;
  esac
done

if [ -z "$MODULE" ] || [ -z "$ACTION" ]; then
  usage >&2
  exit 1
fi

MODULE_DIR="$MODULES_DIR/$MODULE"
[ -d "$MODULE_DIR" ] || die "$MODULE_DIR does not exist — create the context first: pnpm gen:module $MODULE"

for value in "$MODULE" "$ACTION"; do
  if ! printf '%s' "$value" | grep -q -E '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'; then
    die "\"$value\" is not kebab-case — use lowercase words separated by single hyphens."
  fi
done

USE_CASE_FILE="$MODULE_DIR/application/$ACTION.use-case.ts"
[ ! -e "$USE_CASE_FILE" ] || die "$USE_CASE_FILE already exists."

[ -d "$TEMPLATE_DIR" ] || die "template directory $TEMPLATE_DIR is missing."

to_pascal() {
  printf '%s' "$1" | awk -F- '{ out = ""; for (i = 1; i <= NF; i++) out = out toupper(substr($i, 1, 1)) substr($i, 2); print out }'
}

to_camel() {
  pascal=$(to_pascal "$1")
  printf '%s%s' \
    "$(printf '%s' "$pascal" | cut -c1 | tr 'A-Z' 'a-z')" \
    "$(printf '%s' "$pascal" | cut -c2-)"
}

MODULE_KEBAB=$MODULE
MODULE_PASCAL=$(to_pascal "$MODULE")
MODULE_CAMEL=$(to_camel "$MODULE")
MODULE_SCREAM=$(printf '%s' "$MODULE" | tr 'a-z-' 'A-Z_')
ACTION_KEBAB=$ACTION
ACTION_PASCAL=$(to_pascal "$ACTION")
ACTION_CAMEL=$(to_camel "$ACTION")

rename_placeholders() {
  sed -e "s/__MODULE_KEBAB__/$MODULE_KEBAB/g" \
    -e "s/__MODULE_PASCAL__/$MODULE_PASCAL/g" \
    -e "s/__MODULE_CAMEL__/$MODULE_CAMEL/g" \
    -e "s/__MODULE_SCREAM__/$MODULE_SCREAM/g" \
    -e "s/__ACTION_KEBAB__/$ACTION_KEBAB/g" \
    -e "s/__ACTION_PASCAL__/$ACTION_PASCAL/g" \
    -e "s/__ACTION_CAMEL__/$ACTION_CAMEL/g"
}

CREATED=''

discard_partial_output() {
  status=$?
  if [ "$status" -ne 0 ] && [ -n "$CREATED" ]; then
    printf '%s\n' "$CREATED" | while IFS= read -r file; do
      [ -z "$file" ] || rm -f "$file"
    done
  fi
  exit "$status"
}

trap discard_partial_output EXIT
trap 'exit 130' INT TERM

printf 'gen:usecase: %s in %s (%s)\n' "$ACTION" "$MODULE" "$KIND"

render() {
  template=$1
  destination=$2

  [ ! -e "$destination" ] || die "$destination already exists."

  mkdir -p "$(dirname "$destination")"
  rename_placeholders <"$template" >"$destination"
  CREATED=$(printf '%s\n%s' "$CREATED" "$destination")

  printf '  + %s\n' "$destination"
}

render "$TEMPLATE_DIR/application/__ACTION_KEBAB__.use-case.ts.tpl" \
  "$MODULE_DIR/application/$ACTION.use-case.ts"
render "$TEMPLATE_DIR/application/__ACTION_KEBAB__.use-case.spec.ts.tpl" \
  "$MODULE_DIR/application/$ACTION.use-case.spec.ts"

if [ "$KIND" = 'command' ]; then
  render "$TEMPLATE_DIR/http/dto/__ACTION_KEBAB__.request.dto.ts.tpl" \
    "$MODULE_DIR/http/dto/$ACTION.request.dto.ts"
fi

cat <<MANUAL

The scaffold rejects every call until you implement it. Three steps remain:

  1. Implement ${ACTION_PASCAL}UseCase.execute: inject the ports it needs and
     replace the failing scaffold body, then replace the placeholder spec with
     tests for the real behaviour.

  2. Register the provider in $MODULE_DIR/$MODULE_KEBAB.module.ts:

       providers: [..., ${ACTION_PASCAL}UseCase]

  3. Expose it from the controller in $MODULE_DIR/http/:

       constructor(..., private readonly ${ACTION_CAMEL}: ${ACTION_PASCAL}UseCase) {}

Then: pnpm typecheck && pnpm boundaries && pnpm lint && pnpm test
MANUAL
