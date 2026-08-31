-- The single baseline migration for this boilerplate.
--
-- A boilerplate has no deployed history to preserve, so the schema is expressed
-- once rather than as a replay of how it was discovered. Everything above the
-- "beyond the datamodel" marker is generated from prisma/models and must stay
-- that way: regenerate it with
--   pnpm exec prisma migrate diff --from-empty --to-schema prisma --script
-- and re-append the section below, which Prisma cannot express in a datamodel.
--
-- When you add a required column to a table that already holds rows, do not
-- copy the shape of this file. See docs/decisions/0002-expand-migrate-contract.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "messaging";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "notifications";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tenancy";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "upload";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "users";

-- CreateEnum
CREATE TYPE "billing"."subscription_status" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');

-- CreateEnum
CREATE TYPE "tenancy"."organization_member_role" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "upload"."stored_file_status" AS ENUM ('pending', 'confirmed', 'discarded');

-- CreateTable
CREATE TABLE "audit"."audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor_id" UUID,
    "organization_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "resource" VARCHAR(120) NOT NULL,
    "resource_id" UUID,
    "request_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."user" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" VARCHAR(32) NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."session" (
    "id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."account" (
    "id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "provider_id" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."verification" (
    "id" UUID NOT NULL,
    "identifier" VARCHAR(320) NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."plan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."subscription" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "billing"."subscription_status" NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_ref" VARCHAR(255),
    "current_period_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."webhook_inbox_event" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(3),
    "processing_token" UUID,
    "processed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(2000),

    CONSTRAINT "webhook_inbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."outbox_events" (
    "event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "event_name" VARCHAR(120) NOT NULL,
    "schema_version" SMALLINT NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "drained_at" TIMESTAMPTZ(3),
    "claim_token" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(2000),
    "dead_lettered_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "notifications"."sent_notification" (
    "idempotency_key" VARCHAR(128) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_notification_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateTable
CREATE TABLE "tenancy"."organization" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy"."organization_member" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenancy"."organization_member_role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenancy"."organization_invitation" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "tenancy"."organization_member_role" NOT NULL DEFAULT 'member',
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload"."stored_file" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "declared_mime_type" VARCHAR(255) NOT NULL,
    "declared_size_bytes" INTEGER NOT NULL,
    "verified_mime_type" VARCHAR(255),
    "verified_size_bytes" INTEGER,
    "status" "upload"."stored_file_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users"."user_profile" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "avatar_file_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_id_idx" ON "audit"."audit_log"("occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_id_occurred_at_idx" ON "audit"."audit_log"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_organization_id_occurred_at_idx" ON "audit"."audit_log"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "user_created_at_id_idx" ON "auth"."user"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "auth"."user"("email");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "auth"."session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "auth"."session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "auth"."session"("token");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "auth"."account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "auth"."verification"("identifier");

-- CreateIndex
CREATE INDEX "verification_expires_at_idx" ON "auth"."verification"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "billing"."plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_organization_id_key" ON "billing"."subscription"("organization_id");

-- CreateIndex
CREATE INDEX "subscription_plan_id_status_idx" ON "billing"."subscription"("plan_id", "status");

-- CreateIndex
CREATE INDEX "webhook_inbox_event_provider_processed_at_idx" ON "billing"."webhook_inbox_event"("provider", "processed_at");

-- CreateIndex
CREATE INDEX "webhook_inbox_event_processing_at_idx" ON "billing"."webhook_inbox_event"("processing_at");

-- CreateIndex
CREATE INDEX "webhook_inbox_event_failed_at_idx" ON "billing"."webhook_inbox_event"("failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_event_provider_provider_event_id_key" ON "billing"."webhook_inbox_event"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "outbox_events_occurred_at_idx" ON "messaging"."outbox_events"("occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_claimed_at_idx" ON "messaging"."outbox_events"("claimed_at");

-- CreateIndex
CREATE INDEX "outbox_events_dead_lettered_at_idx" ON "messaging"."outbox_events"("dead_lettered_at");

-- CreateIndex
CREATE INDEX "sent_notification_sent_at_idx" ON "notifications"."sent_notification"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "tenancy"."organization"("slug");

-- CreateIndex
CREATE INDEX "organization_created_at_id_idx" ON "tenancy"."organization"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "organization_member_user_id_created_at_idx" ON "tenancy"."organization_member"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "organization_member_organization_id_role_idx" ON "tenancy"."organization_member"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_member_organization_id_user_id_key" ON "tenancy"."organization_member"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitation_token_hash_key" ON "tenancy"."organization_invitation"("token_hash");

-- CreateIndex
CREATE INDEX "organization_invitation_organization_id_email_idx" ON "tenancy"."organization_invitation"("organization_id", "email");

-- CreateIndex
CREATE INDEX "organization_invitation_expires_at_idx" ON "tenancy"."organization_invitation"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_storage_key_key" ON "upload"."stored_file"("storage_key");

-- CreateIndex
CREATE INDEX "stored_file_organization_id_owner_id_created_at_idx" ON "upload"."stored_file"("organization_id", "owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stored_file_created_at_id_idx" ON "upload"."stored_file"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stored_file_status_created_at_idx" ON "upload"."stored_file"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_user_id_key" ON "users"."user_profile"("user_id");

-- CreateIndex
CREATE INDEX "user_profile_created_at_id_idx" ON "users"."user_profile"("created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing"."plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscription" ADD CONSTRAINT "subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."organization_member" ADD CONSTRAINT "organization_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."organization_member" ADD CONSTRAINT "organization_member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."organization_invitation" ADD CONSTRAINT "organization_invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload"."stored_file" ADD CONSTRAINT "stored_file_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users"."user_profile" ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Beyond the datamodel: triggers, functions and partial indexes.
-- Prisma cannot express these, so they are maintained by hand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Identity changes become integration events in the same transaction that made
-- them. Writing to the outbox from a trigger is what makes "the user exists"
-- and "something must react to it" atomic: there is no window in which one is
-- true and the other is lost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "messaging"."enqueue_auth_user_event"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = messaging, pg_catalog
AS $$
DECLARE
  v_event_name TEXT;
  v_payload    JSONB;
  v_now        TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_event_name := 'users.registered';
    v_payload := jsonb_build_object(
      'userId',        NEW.id::text,
      'email',         NEW.email,
      'emailVerified', NEW.email_verified,
      'registeredAt',  to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.email_verified IS DISTINCT FROM NEW.email_verified AND NEW.email_verified) THEN
      v_event_name := 'users.email_verified';
      v_payload := jsonb_build_object(
        'userId',     NEW.id::text,
        'email',      NEW.email,
        'verifiedAt', v_now
      );
    ELSE
      RETURN NULL;
    END IF;

  ELSIF (TG_OP = 'DELETE') THEN
    v_event_name := 'users.deleted';
    v_payload := jsonb_build_object(
      'userId',    OLD.id::text,
      'deletedAt', v_now
    );
  END IF;

  INSERT INTO "messaging"."outbox_events" ("event_id", "occurred_at", "event_name", "schema_version", "payload")
  VALUES (uuidv7(), now(), v_event_name, 1, v_payload);

  RETURN NULL;
END;
$$;

CREATE TRIGGER "auth_user_registered"
  AFTER INSERT ON "auth"."user"
  FOR EACH ROW EXECUTE FUNCTION "messaging"."enqueue_auth_user_event"();

CREATE TRIGGER "auth_user_email_verified"
  AFTER UPDATE OF "email_verified" ON "auth"."user"
  FOR EACH ROW EXECUTE FUNCTION "messaging"."enqueue_auth_user_event"();

CREATE TRIGGER "auth_user_deleted"
  AFTER DELETE ON "auth"."user"
  FOR EACH ROW EXECUTE FUNCTION "messaging"."enqueue_auth_user_event"();

-- ---------------------------------------------------------------------------
-- An organization always has an owner.
--
-- organization_member cascades from auth.user, so deleting the last owning
-- account would silently leave an organization nobody can archive, restore or
-- purge — and since only an owner can appoint another owner, no way back. The
-- application checks this before it deletes; the cascade fires below the
-- application, so the guarantee lives here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "tenancy"."refuse_last_owner_deletion"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = tenancy, pg_catalog
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  SELECT mine.organization_id
    INTO v_organization_id
    FROM tenancy.organization_member AS mine
   WHERE mine.user_id = OLD.id
     AND mine.role = 'owner'
     AND NOT EXISTS (
           SELECT 1
             FROM tenancy.organization_member AS other
            WHERE other.organization_id = mine.organization_id
              AND other.role = 'owner'
              AND other.user_id <> mine.user_id
         )
   LIMIT 1;

  IF v_organization_id IS NOT NULL THEN
    RAISE EXCEPTION
      'user % is the only owner of organization %', OLD.id, v_organization_id
      USING ERRCODE = 'restrict_violation',
            HINT = 'Transfer ownership, or archive and purge the organization, before deleting this account.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "auth_user_last_owner_guard"
  BEFORE DELETE ON "auth"."user"
  FOR EACH ROW EXECUTE FUNCTION "tenancy"."refuse_last_owner_deletion"();

-- ---------------------------------------------------------------------------
-- Partial indexes. A datamodel index covers the whole table; these cover only
-- the rows a hot query actually looks at, which is what keeps them small on
-- tables that mostly contain finished work.
-- ---------------------------------------------------------------------------

-- The relay claims from the undrained, unquarantined head of the queue.
CREATE INDEX "outbox_events_pending_claim_idx"
  ON "messaging"."outbox_events" ("occurred_at")
  WHERE "drained_at" IS NULL AND "dead_lettered_at" IS NULL;

-- Retention deletes the opposite set, so it needs its own index: every other
-- index on this table filters for drained_at IS NULL.
CREATE INDEX "outbox_events_drained_at_idx"
  ON "messaging"."outbox_events" ("drained_at")
  WHERE "drained_at" IS NOT NULL;

-- Same shape on the webhook inbox: prune reads processed rows by age.
CREATE INDEX "webhook_inbox_event_processed_at_idx"
  ON "billing"."webhook_inbox_event" ("processed_at")
  WHERE "processed_at" IS NOT NULL;
