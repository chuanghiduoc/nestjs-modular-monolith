## What changed, and why

<!-- The reason, not the diff. The diff is below. -->

## Scope check

- [ ] `pnpm verify` passes locally
- [ ] Tests fail without the change (a green test that never went red proves nothing)

## If this touches a boundary

- [ ] Persisted data → a migration exists, and `pnpm db:diff` is clean
- [ ] A new queue → it is in `QUEUE_DEFINITIONS`, and something enqueues it
- [ ] A new env variable → it is in `.env.example`, and `pnpm doctor` is clean
- [ ] A new error code → it has an `ERROR_CATALOG` entry
- [ ] A cross-boundary call → timeout, retry and idempotency decided, not assumed
- [ ] Hard to reverse → an ADR, or a note saying why one is not needed
