-- D52 prerequisite (spec §4): deciders are allow-checked. No machine decider is a lasting grant.
ALTER TABLE "vault_grants" DROP CONSTRAINT "vault_grants_human_approver";--> statement-breakpoint
DELETE FROM "vault_grants" WHERE NOT ("vault_grants"."approved_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("vault_grants"."approved_by") NOT IN ('policy', 'bypass', 'observer', 'agent', 'guard', 'watcher', 'copilot'));--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_human_approver" CHECK ("vault_grants"."approved_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower("vault_grants"."approved_by") NOT IN ('policy', 'bypass', 'observer', 'agent', 'guard', 'watcher', 'copilot'));--> statement-breakpoint
-- A lasting grant names a real person: approved_by references "user" (a deleted user's grants go).
DELETE FROM "vault_grants" WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "vault_grants"."approved_by");--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_ck" CHECK ("approvals"."decided_by" IS NULL OR "approvals"."decided_by" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');--> statement-breakpoint
-- D52 Observer (spec §6, §7): drizzle-kit's diff for the schema below, then the hand-written views.
CREATE SCHEMA "observer";
--> statement-breakpoint
CREATE TYPE "public"."observer_mode" AS ENUM('shadow', 'enforce');--> statement-breakpoint
ALTER TYPE "public"."approval_kind" ADD VALUE 'data_egress';--> statement-breakpoint
ALTER TYPE "public"."approval_kind" ADD VALUE 'observer';--> statement-breakpoint
CREATE TABLE "guard_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_seq" integer NOT NULL,
	"stage" text NOT NULL,
	"verdict" text NOT NULL,
	"category" text NOT NULL,
	"rollout" text NOT NULL,
	"applied" boolean NOT NULL,
	"input" jsonb,
	"latency_ms" integer NOT NULL,
	"usd" numeric(12, 6) NOT NULL,
	"consecutive" integer NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer"."copilot_items" (
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"item" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_items_thread_id_seq_pk" PRIMARY KEY("thread_id","seq")
);
--> statement-breakpoint
CREATE TABLE "observer"."copilot_results" (
	"thread_id" uuid NOT NULL,
	"result_id" text NOT NULL,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"query" jsonb NOT NULL,
	"columns" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"took_ms" integer NOT NULL,
	"tainted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copilot_results_thread_id_result_id_pk" PRIMARY KEY("thread_id","result_id")
);
--> statement-breakpoint
CREATE TABLE "observer"."copilot_spend" (
	"day" date PRIMARY KEY NOT NULL,
	"usd" numeric(12, 6) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observer"."copilot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT "alerts_rule_ck";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "observer_mode" "observer_mode" DEFAULT 'enforce' NOT NULL;--> statement-breakpoint
ALTER TABLE "guard_reviews" ADD CONSTRAINT "guard_reviews_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer"."copilot_items" ADD CONSTRAINT "copilot_items_thread_id_copilot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "observer"."copilot_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observer"."copilot_results" ADD CONSTRAINT "copilot_results_thread_id_copilot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "observer"."copilot_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guard_reviews_run_idx" ON "guard_reviews" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_threads_ws_idx" ON "observer"."copilot_threads" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_ck" CHECK (rule in ('error_spike', 'model_request_rejected', 'run_failed', 'slot_crash_loop', 'spend_jump', 'observer_escalation', 'observer_failure'));--> statement-breakpoint
-- Copilot read model (spec §7.3): listed columns only, security_barrier, owned by the migration
-- owner (not security_invoker), so observer_role needs no grant on any public table.
CREATE VIEW "observer"."runs" WITH (security_barrier = true) AS
  SELECT id, workspace_id, status, wait_reason, controller, approval_mode, observer_mode, tool_profile,
         model, budget, usage, error->>'code' AS error_code, title, created_at, finished_at, last_activity_at
  FROM "public"."runs";--> statement-breakpoint
CREATE VIEW "observer"."run_goals" WITH (security_barrier = true) AS
  SELECT id, workspace_id, goal FROM "public"."runs";--> statement-breakpoint
CREATE VIEW "observer"."run_steps" WITH (security_barrier = true) AS
  SELECT run_id, seq, phase, state, action->>'tool' AS tool,
         substring(url from '^(https?://[^/?#]+)') AS origin, caption, usage, created_at
  FROM "public"."run_steps";--> statement-breakpoint
CREATE VIEW "observer"."approvals" WITH (security_barrier = true) AS
  SELECT id, run_id, step_seq, kind, status,
         CASE WHEN decided_by IS NULL THEN NULL
              WHEN decided_by IN ('policy', 'bypass', 'observer', 'agent') THEN decided_by
              WHEN decided_by ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' AND lower(decided_by) NOT IN ('policy', 'bypass', 'observer', 'agent', 'guard', 'watcher', 'copilot') THEN 'person'
              ELSE 'unknown' END AS decider,
         decided_at, created_at
  FROM "public"."approvals";--> statement-breakpoint
CREATE VIEW "observer"."run_events" WITH (security_barrier = true) AS
  SELECT id, run_id, type,
         CASE WHEN type = 'guard' THEN payload->>'verdict' END AS guard_verdict,
         CASE WHEN type = 'guard' THEN payload->>'category' END AS guard_category,
         created_at
  FROM "public"."run_events";--> statement-breakpoint
CREATE VIEW "observer"."guard_reviews" WITH (security_barrier = true) AS
  SELECT run_id, step_seq, stage, verdict, category, rollout, applied, latency_ms, usd, created_at
  FROM "public"."guard_reviews";--> statement-breakpoint
CREATE VIEW "observer"."browser_slots" WITH (security_barrier = true) AS
  SELECT name, state, restarted_at FROM "public"."browser_slots";--> statement-breakpoint
CREATE VIEW "observer"."downloads" WITH (security_barrier = true) AS
  SELECT run_id, bytes, pending, kept_at, discarded_at, created_at FROM "public"."downloads";--> statement-breakpoint
CREATE VIEW "observer"."alerts" WITH (security_barrier = true) AS
  SELECT id, workspace_id, rule, fired_at, acknowledged_at FROM "public"."alerts";
