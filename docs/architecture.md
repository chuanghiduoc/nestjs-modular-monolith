# Architecture Contract

This repository is a SaaS backend foundation. The source tree is organised by
ownership and runtime responsibility:

```text
src/
  bootstrap/       process composition, configuration and transport setup
  contracts/       stable ports and integration-event contracts
  modules/         product capabilities (bounded contexts)
  platform/        replaceable infrastructure adapters
  composition/     read-side and cross-context orchestration
  shared/          framework-free primitives
```

## Naming rules

- A module is named after a business capability: `organizations`, `billing`,
  `catalog`, `notifications`.
- `users` is reserved for identity provider concerns. Profile and membership
  data belong to their owning capabilities, not authentication records.
- Files use `kebab-case`; classes use `PascalCase`; ports end in `Port`; adapters
  name the technology (`Prisma...Repository`, `BullMq...Adapter`).
- `platform` is infrastructure, never a business capability.
- `composition` may aggregate read models, but must not own transactional state.

Every customer-owned record is tenant-scoped. Requests, jobs and integration
events carry `organizationId` when operating on tenant data. Authorization is
evaluated against organization membership, never only a global user role. The
boilerplate schema enforces this with non-null tenant columns and foreign keys;
legacy data migrations must backfill before applying the contract.

## Lifecycle And Deletion

Tenant resources use an expand-migrate-contract rollout when introducing a new
`organizationId` in an existing deployment: add the column, backfill from a
real membership mapping, enforce tenant-aware reads/writes, then make it
required. Fresh boilerplate schemas must start with the required column.

The schema ships as one baseline migration, because a boilerplate has no
deployed history to replay. That baseline is therefore not an example of how to
change a populated table — `docs/decisions/0002-expand-migrate-contract.md` is. Never
infer an organization id from a user id. Soft deletion is the default for
recoverable business records; hard deletion is a separate, owner-authorized
purge workflow with dependency checks.
