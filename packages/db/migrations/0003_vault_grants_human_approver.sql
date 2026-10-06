-- A grant decided by the auto-mode policy was never a lasting grant (R-E7): drop any before the CHECK.
DELETE FROM "vault_grants" WHERE "approved_by" = 'policy';--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_human_approver" CHECK ("vault_grants"."approved_by" <> 'policy');
