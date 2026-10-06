CREATE OR REPLACE FUNCTION folders_check_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  depth integer := 1;
  subtree_height integer := 0;
  cur uuid := NEW.parent_id;
  parent_workspace uuid;
BEGIN
  -- Serialize tree edits per workspace so two concurrent moves cannot form a cycle.
  PERFORM pg_advisory_xact_lock(hashtext('folders:' || NEW.workspace_id::text));
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT workspace_id INTO parent_workspace FROM folders WHERE id = NEW.parent_id;
  IF parent_workspace IS NULL THEN
    RAISE EXCEPTION 'folder parent % does not exist', NEW.parent_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'folder parent belongs to another workspace' USING ERRCODE = 'check_violation';
  END IF;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'folder move would create a cycle' USING ERRCODE = 'check_violation';
    END IF;
    depth := depth + 1;
    SELECT parent_id INTO cur FROM folders WHERE id = cur;
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE sub(id, h) AS (
      SELECT f.id, 1 FROM folders f WHERE f.parent_id = NEW.id
      UNION ALL
      SELECT f.id, s.h + 1 FROM folders f JOIN sub s ON f.parent_id = s.id
    )
    SELECT coalesce(max(h), 0) INTO subtree_height FROM sub;
  END IF;
  IF depth + subtree_height > 8 THEN
    RAISE EXCEPTION 'folder depth exceeds 8' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER folders_check_tree
  BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON folders
  FOR EACH ROW EXECUTE FUNCTION folders_check_tree();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vault_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vault_audit is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER vault_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON vault_audit
  FOR EACH ROW EXECUTE FUNCTION vault_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER vault_audit_no_truncate
  BEFORE TRUNCATE ON vault_audit
  FOR EACH STATEMENT EXECUTE FUNCTION vault_audit_append_only();
