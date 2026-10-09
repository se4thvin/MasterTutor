-- Idempotent least-privilege grants (spec §3.1 rule 5). Re-applied by every migrate run,
-- inside one transaction, so new tables get the policy below automatically.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_role') THEN
    CREATE ROLE web_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_role') THEN
    CREATE ROLE agent_role NOLOGIN;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM web_role, agent_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM web_role, agent_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO web_role, agent_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_role, agent_role;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    -- web: everything except the transcript, sealed material and the audit log (handled below).
    IF t NOT IN ('run_transcript', 'vault_secrets', 'vault_grants', 'otp_codes', 'browser_sessions', 'vault_audit') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO web_role', t);
    END IF;
    -- agent: everything except Better Auth's tables, the audit log (handled below), and web-only
    -- alert state (D50).
    IF t NOT IN ('user', 'session', 'account', 'verification', 'vault_audit', 'alerts', 'push_subscriptions') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO agent_role', t);
    END IF;
  END LOOP;
END $$;

-- Grants are written only by the agent, and only from a human approval (S1).
GRANT SELECT ON vault_grants TO web_role;

-- web seals but cannot read sealed columns back.
GRANT INSERT, UPDATE, DELETE ON vault_secrets TO web_role;
GRANT SELECT (id, item_id, field, created_at, updated_at) ON vault_secrets TO web_role;
GRANT INSERT ON otp_codes TO web_role;
GRANT SELECT (id, run_id, item_id, expires_at, consumed_at, created_at) ON otp_codes TO web_role;
GRANT DELETE ON browser_sessions TO web_role;
GRANT SELECT (id, workspace_id, alias, origin, created_at, updated_at) ON browser_sessions TO web_role;

-- Live revocation's reconcile asks only whether a person still has an unexpired session.
GRANT SELECT (user_id, expires_at) ON "session" TO agent_role;

-- The audit log is append-only for both services (a trigger also blocks the owner).
GRANT SELECT, INSERT ON vault_audit TO web_role, agent_role;
