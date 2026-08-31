# NestJS Modular Monolith

Production-minded **NestJS + Fastify** modular monolith for SaaS products — one
source tree, three independently scalable runtime roles, and the boring parts of
a multi-tenant backend already solved: tenancy, auth, a transactional outbox,
background jobs, uploads, billing webhooks, audit and observability.

[![ci](https://github.com/chuanghiduoc/nestjs-modular-monolith/actions/workflows/ci.yml/badge.svg)](https://github.com/chuanghiduoc/nestjs-modular-monolith/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![typescript](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)

## Contents

- [Runtime roles](#runtime-roles)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Testing](#testing)
- [What is included](#what-is-included)
- [Decisions worth knowing](#decisions-worth-knowing)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Runtime roles

```text
node dist/main.api.js        # HTTP API, auth, probes and metrics
node dist/main.worker.js     # BullMQ workers and external side effects
node dist/main.scheduler.js  # outbox relay and scheduled maintenance
node dist/main.all.js        # all three in one process
```

`main.all.js` builds the same three applications — separate module graphs,
separate configuration, separate database credentials — and hosts them in one
process. It is what to run while developing, and a defensible way to deploy a
small installation: roughly 167 MB resident instead of ~350 MB across three
processes. What it gives up is the isolation that motivates the split in the
first place, because one event loop now serves HTTP requests and background jobs
alike. Scale past one instance and the three separate entrypoints are what you
want, not least because the scheduler must stay a singleton.

## Quick start

**Requirements:** Node.js >= 24, pnpm 11, Docker (for the local stack and for the
integration/e2e suites).

```bash
pnpm install
cp .env.example .env      # set BETTER_AUTH_SECRET to >= 32 random bytes
pnpm infra:up             # PostgreSQL, Redis, MinIO, Mailpit
pnpm db:migrate
pnpm build
pnpm dev:all
```

`pnpm dev:all` runs every role in one process behind a single `tsc --watch` and a
single reload. Running `pnpm dev`, `pnpm dev:worker` and `pnpm dev:scheduler` in
three terminals also works and gives one role per window, at the cost of three
compilers watching the same files and writing the same `dist/`.

Running only `pnpm dev` is enough for HTTP and auth work, but nothing will
consume queues or drain the outbox — a freshly registered user gets no profile
and no mail until a worker and a scheduler are running too.

`REDIS_URL` is required by all roles, because BullMQ is the job broker.

## Architecture

- **PostgreSQL + Prisma** own transactional business data and the transactional
  outbox.
- **Redis + BullMQ** own background jobs. Redis is deliberately separate from the
  OLTP database so worker backlog cannot consume database queue tables or
  connection capacity.
- **The outbox relay** claims rows with a lease, publishes deterministic BullMQ
  jobs, then marks rows drained. A crashed relay safely retries once the lease
  expires; contracts it cannot parse are quarantined rather than replayed
  forever.
- **Application code depends on ports and contracts.** A use case does not import
  Prisma, BullMQ, Fastify or an email provider — `dependency-cruiser` enforces
  that in CI, not just by convention.

## Project layout

```text
src/
  bootstrap/       process composition, configuration and HTTP setup
  contracts/       stable ports and integration-event contracts
  modules/         business capabilities: organizations, users, uploads, ...
  platform/        replaceable adapters: Prisma, Redis, BullMQ, auth, storage
  composition/     cross-context read-side orchestration
  shared/          framework-free primitives
```

Name modules after business capabilities (`organizations`, `billing`, `catalog`),
not technical buckets (`common`, `core`, `utils`). Authentication identity is
global; customer-owned data is scoped to an organization and must carry
`organizationId` through requests, jobs and events.

`pnpm gen:module` scaffolds a new bounded context in the shape the boundary rules
expect.

## Scripts

| Command                                                   | What it does                                        |
| --------------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev:all`                                            | All three roles in one process, watch mode          |
| `pnpm dev` / `dev:worker` / `dev:scheduler`               | One role per terminal                               |
| `pnpm infra:up` / `infra:down`                            | Local Docker stack                                  |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Prisma workflows                                    |
| `pnpm build`                                              | `prisma generate` + `tsc`                           |
| `pnpm verify`                                             | Every gate below, in CI order                       |
| `pnpm lint` / `format:check` / `typecheck` / `boundaries` | Individual gates                                    |
| `pnpm test` / `test:int` / `test:e2e` / `test:all`        | Unit / integration / e2e / everything with coverage |
| `pnpm gen:module`                                         | Scaffold a bounded context                          |
| `pnpm doctor`                                             | Check the local toolchain and environment           |

## Testing

```bash
pnpm test        # unit
pnpm test:int    # integration (Testcontainers: PostgreSQL, Redis)
pnpm test:e2e    # end-to-end against a booted application
pnpm test:all    # all suites with coverage thresholds enforced
```

The TypeScript and ESLint configuration is strict and rejects explicit `any`,
floating promises, unsafe promise callbacks, import-order drift and boundary
violations. Integration and end-to-end suites need a running Docker daemon.

## What is included

- **Organizations** with a full membership lifecycle: invite by email, accept,
  change role, remove, and an "always at least one owner" invariant enforced by a
  database trigger as well as by the application.
- **Authentication** through Better Auth, with session and verification
  retention.
- **Background jobs** on BullMQ: retry, capped backoff, delayed jobs and cron
  schedules. Pause, resume and retry-failed exist on the queue admin port but are
  deliberately not exposed over HTTP — wire them to your own operator tooling.
- **Transactional outbox** with claim leases, bounded at-least-once relay
  attempts, quarantined invalid contracts and replay/retention controls.
- **Billing** that is provider-neutral: subscriptions, entitlement checks, and a
  signed webhook endpoint with HMAC verification, an idempotent inbox with
  processing leases, and a queued hand-off to the worker.
- **Uploads** through presigned URLs with server-side verification of what
  actually landed in the bucket.
- **Multi-tenancy** controls: soft archive, owner-only restore and guarded hard
  purge.
- **Audit log**, object storage, and email notifications with a durable send-once
  ledger rather than a best-effort provider header.
- **Localization** of error messages with `en` and `vi` catalogs.
- **Observability**: Prometheus metrics, request IDs, redacted structured logs,
  readiness checks and shipped alert rules.

Billing provider SDKs remain adapters. Stripe, Paddle, Lemon Squeezy or an
internal provider can implement the billing ports without leaking SDK types into
domain or application code. SSO/SCIM remains an extension point.

Deciding what a provider's event _means_ for a subscription is the one part left
open on purpose — implement `BillingEventApplierPort` and grant `app_worker`
write access to `billing.subscription` at the same time. No application role
holds that privilege by default, because entitlements are configuration.

BullMQ's retained `failed` state is the operational dead-letter store. Failed
jobs are kept for a bounded period and can be retried or removed through the
queue admin port; PostgreSQL is never used as a job queue.

## Decisions worth knowing

### Deletion policy

Business resources are archived first. Restore is explicit and audited. Hard
purge is owner-only, idempotent, and refuses to run while tenant-owned files or a
_live_ subscription still exist — a cancelled subscription is history and is
removed with the organization, because a tenant that once paid must still be
erasable. Object-storage cleanup must complete before the organization can be
purged. Outbox and BullMQ retention use physical TTL cleanup, because those
records are operational rather than customer data.

An account cannot be deleted while it is the only owner of an organization:
ownership has to be transferred, or the organization archived and purged, first.
That rule is a database trigger, not only an application check, because the
membership row is removed by a cascade that runs below the application.

Authentication identities are otherwise different: Better Auth performs an
explicit account deletion, PostgreSQL cascades identity-owned rows, and the
resulting transactional `users.deleted` event drives asynchronous profile and
object-storage cleanup. A failed cleanup stays visible as a retained BullMQ
failed job for operator retry. Billing webhook inbox rows are retained for 90
days after successful processing; the scheduled `billing.webhook-prune` job
deletes them in bounded batches.

### Credentials and the broker

Two queues carry a bearer token in their payload — the auth mail queue and the
invitation queue — because a link cannot be composed without one. Both drop a
completed job immediately and keep a failed one for minutes rather than weeks,
and neither puts a token in a Redis key name. Nothing else in this system stores
a credential outside PostgreSQL. If you add a queue that carries one, set
`completedJobRetentionSeconds: 0` and give it a short failure retention.

### Upload verification

The server never sees the bytes of a presigned upload, so confirming one is where
the claims get checked. Confirmation reads the stored object and requires all
three to hold: the size matches what was declared, the first 4 KB carry a
magic-byte signature on the allow-list, and that signature is the _same type_ the
client declared. Anything else is discarded and swept, object and row together.

That defeats a renamed extension and a mislabelled content type; it does not
defeat a polyglot file, and `application/pdf` is on the allow-list. If uploads are
served back to other users, add a virus scan and serve them with
`Content-Disposition: attachment` from a separate origin.

### Sessions are not cached

Every authenticated request reads its session row. Better Auth's signed cookie
cache would remove most of those reads and is the obvious optimisation to reach
for — it is deliberately off, because a cached session stays valid after it is
revoked, and `revokeSessionsOnPasswordReset` is what locks out a stolen session.
An e2e test asserts the old cookie is refused immediately. Turning the cache on
is a product decision that weakens that promise; if you take it, rewrite the test
to state the weaker one honestly.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — the architecture contract:
  naming, layering and the rules CI enforces.
- [`docs/decisions/`](docs/decisions) — architecture decision records.
- [`.github/SECURITY.md`](.github/SECURITY.md) — how to report a vulnerability.

## Contributing

Issues and pull requests are welcome. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) (`commitlint`
enforces it), and `lefthook` runs the fast gates before a commit lands. Please
make sure `pnpm verify` passes before opening a pull request.

## License

[MIT](LICENSE)
