DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['app_api', 'app_worker', 'app_scheduler'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', role_name);
    END IF;

    EXECUTE format(
      'GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name
    );
  END LOOP;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA auth, users, audit, upload, messaging, tenancy, billing, notifications FROM PUBLIC;

GRANT USAGE ON SCHEMA auth, users, audit, upload, messaging, tenancy, billing, notifications
  TO app_api, app_worker, app_scheduler;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, users, upload TO app_api;
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO app_api;
GRANT INSERT ON messaging.outbox_events TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenancy TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenancy
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
GRANT SELECT ON ALL TABLES IN SCHEMA billing TO app_api, app_worker;
GRANT INSERT, UPDATE ON billing.webhook_inbox_event TO app_api, app_worker;
-- Neither application role may write billing.plan or billing.subscription: what
-- a customer is entitled to is configuration, not something a request handler or
-- a queue consumer changes on its own. Wiring a real provider means granting
-- INSERT, UPDATE on billing.subscription to app_worker deliberately, alongside
-- the applier you implement.
--
-- The one exception is deletion, and only as part of purging a tenant: that runs
-- in the same owner-authorised transaction that removes the organization.
GRANT DELETE ON billing.subscription TO app_api;
GRANT DELETE ON billing.webhook_inbox_event TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT SELECT ON TABLES TO app_api, app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth, users, upload
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT ON TABLES TO app_api;

GRANT SELECT ON ALL TABLES IN SCHEMA auth TO app_worker;
GRANT DELETE ON auth.session, auth.verification TO app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA users, upload, audit TO app_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA tenancy TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA users, upload, audit
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenancy GRANT SELECT ON TABLES TO app_worker;

GRANT SELECT, UPDATE, DELETE ON ALL TABLES IN SCHEMA messaging TO app_scheduler;
ALTER DEFAULT PRIVILEGES IN SCHEMA messaging
  GRANT SELECT, UPDATE, DELETE ON TABLES TO app_scheduler;

-- The notification ledger is written by whichever role sends mail (the worker)
-- and pruned by the same role's retention job.
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA notifications TO app_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA notifications
  GRANT SELECT, INSERT, DELETE ON TABLES TO app_worker;
