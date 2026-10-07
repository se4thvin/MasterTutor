ALTER TABLE "runs" ADD COLUMN "live_viewer_id" text;--> statement-breakpoint
-- B6: a Better Auth session that ends (sign-out) or a membership that is removed tells the agent,
-- which alone holds n.eko's admin secret, to close that person's open live views (live_revoke).
CREATE OR REPLACE FUNCTION notify_live_revoke_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('live_revoke', json_build_object('userId', OLD.user_id, 'workspaceId', NULL)::text);
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_live_revoke_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'live_revoke',
    json_build_object('userId', OLD.user_id, 'workspaceId', OLD.workspace_id)::text
  );
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER session_live_revoke AFTER DELETE ON "session"
  FOR EACH ROW EXECUTE FUNCTION notify_live_revoke_session();--> statement-breakpoint
CREATE TRIGGER workspace_members_live_revoke AFTER DELETE ON "workspace_members"
  FOR EACH ROW EXECUTE FUNCTION notify_live_revoke_member();
