-- A grant decided by bypass mode (D44) was never a lasting grant either: drop any before the CHECK.
DELETE FROM "vault_grants" WHERE "approved_by" = 'bypass';--> statement-breakpoint
ALTER TABLE "vault_grants" DROP CONSTRAINT "vault_grants_human_approver";--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_human_approver" CHECK ("vault_grants"."approved_by" NOT IN ('policy', 'bypass'));