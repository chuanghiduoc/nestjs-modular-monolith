# 2. Adding a required column without taking the table down

## Status

Accepted.

## Context

This repository ships a single baseline migration. That is right for a
boilerplate — there is no deployed history to replay, and one file that states
the schema reads better than fourteen that recount how it was discovered.

It also means the tree contains no worked example of adding a required column to
a table that already holds rows, and the baseline's own shape is actively
misleading for that case:

```sql
CREATE TABLE "upload"."stored_file" (
    "organization_id" UUID NOT NULL,   -- fine on an empty schema
    ...
);
ALTER TABLE "upload"."stored_file"
  ADD CONSTRAINT "stored_file_organization_id_fkey" ...;   -- validates the whole table
```

Written as a migration against a populated table, that fails outright: a
`NOT NULL` column with no default has nothing to put in existing rows, and the
foreign key takes an `ACCESS EXCLUSIVE` lock while it validates every one of
them — an outage proportional to table size.

`docs/architecture.md` already requires expand–migrate–contract for tenant
columns. This ADR is the worked example, because the baseline cannot be one.

## Decision

A new required column arrives in four migrations, not one.

**1 — Expand.** Add the column nullable. No default on a large table: a volatile
default rewrites every row.

```sql
ALTER TABLE "upload"."stored_file" ADD COLUMN "organization_id" UUID;
```

**2 — Backfill.** In batches, from a real mapping. Never infer a tenant from a
user id — a user can belong to several organizations, and guessing wrong
silently moves data between tenants.

```sql
UPDATE "upload"."stored_file" AS f
   SET "organization_id" = m."organization_id"
  FROM "tenancy"."organization_member" AS m
 WHERE m."user_id" = f."owner_id"
   AND f."organization_id" IS NULL
   AND f."id" IN (
     SELECT "id" FROM "upload"."stored_file"
      WHERE "organization_id" IS NULL LIMIT 10000
   );
```

Deploy the application version that writes the column before this step, so rows
created during the backfill are already correct.

**3 — Constrain, without a full-table lock.** `NOT VALID` takes a brief lock and
skips existing rows; `VALIDATE CONSTRAINT` then checks them under a lock that
does not block reads or writes.

```sql
ALTER TABLE "upload"."stored_file"
  ADD CONSTRAINT "stored_file_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "upload"."stored_file"
  VALIDATE CONSTRAINT "stored_file_organization_id_fkey";
```

**4 — Contract.** Only once the backfill is verifiably complete:

```sql
ALTER TABLE "upload"."stored_file" ALTER COLUMN "organization_id" SET NOT NULL;
```

Indexes on a live table follow the same principle: `CREATE INDEX CONCURRENTLY`,
outside a transaction.

## Consequences

A required tenant column takes four deploys instead of one. That is the price of
not locking a table that is serving traffic, and the sequence is only necessary
for tables that already hold data — a fresh boilerplate schema still declares the
column required from the start.
