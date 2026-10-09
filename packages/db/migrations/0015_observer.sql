-- D52 prerequisite (spec §4): deciders are allow-checked. No machine decider is a lasting grant.
ALTER TABLE "vault_grants" DROP CONSTRAINT "vault_grants_human_approver";--> statement-breakpoint
DELETE FROM "vault_grants" WHERE NOT ("vault_grants"."approved_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("vault_grants"."approved_by") NOT IN ('policy', 'bypass', 'observer', 'agent'));--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_human_approver" CHECK ("vault_grants"."approved_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("vault_grants"."approved_by") NOT IN ('policy', 'bypass', 'observer', 'agent'));--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_ck" CHECK ("approvals"."decided_by" IS NULL OR "approvals"."decided_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
