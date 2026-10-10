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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'observer_role') THEN
    CREATE ROLE observer_role NOLOGIN CONNECTION LIMIT 4;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM web_role, agent_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM observer_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM web_role, agent_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO web_role, agent_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_role, agent_role;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    -- web: everything except the transcript, sealed material, the audit log (handled below) and the
    -- Guard's reviews, whose stored inputs are the owner's benign replay corpus (D52).
    IF t NOT IN ('run_transcript', 'vault_secrets', 'vault_grants', 'otp_codes', 'browser_sessions', 'vault_audit', 'guard_reviews') THEN
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

-- D52 (spec §7.3): the Copilot's role reads schema observer's views and writes its own replay
-- tables. Nothing in public. Timeouts are accident prevention; grants are the control.
REVOKE ALL ON ALL TABLES IN SCHEMA observer FROM web_role, agent_role, observer_role;
REVOKE ALL ON SCHEMA observer FROM PUBLIC;
GRANT USAGE ON SCHEMA observer TO observer_role;
GRANT SELECT ON observer.runs, observer.run_goals, observer.run_steps, observer.approvals,
  observer.run_events, observer.guard_reviews, observer.browser_slots, observer.downloads,
  observer.alerts TO observer_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON observer.copilot_threads, observer.copilot_items,
  observer.copilot_results, observer.copilot_spend TO observer_role;
ALTER ROLE observer_role SET statement_timeout = '3s';

-- D57: only a person through web can save site preferences; the worker reads defaults.
REVOKE INSERT, UPDATE, DELETE ON capture_preferences FROM agent_role;
