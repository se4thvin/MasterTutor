CREATE TYPE "public"."approval_kind" AS ENUM('risky_click', 'form_submit', 'download', 'credential_first_use', 'new_origin', 'budget');--> statement-breakpoint
CREATE TYPE "public"."approval_mode" AS ENUM('ask', 'auto_within_allowlist');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied', 'edited', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."benchmark_outcome" AS ENUM('pending', 'passed', 'partial', 'failed', 'error');--> statement-breakpoint
CREATE TYPE "public"."block_origin" AS ENUM('dom', 'pdf', 'captions', 'asr', 'ocr_model', 'model', 'user');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('heading', 'paragraph', 'list', 'quote', 'code', 'table', 'math', 'image', 'figure', 'transcript', 'keyframe', 'commentary');--> statement-breakpoint
CREATE TYPE "public"."controller" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."fidelity" AS ENUM('verified', 'partial', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."filed_by" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting', 'sleeping', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."slot_state" AS ENUM('idle', 'leased', 'restarting');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('web', 'pdf', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."step_phase" AS ENUM('observe', 'decide', 'approve', 'act');--> statement-breakpoint
CREATE TYPE "public"."step_state" AS ENUM('started', 'done', 'skipped', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."vault_audit_action" AS ENUM('create', 'update', 'delete', 'fill', 'passkey', 'otp_received', 'denied');--> statement-breakpoint
CREATE TYPE "public"."vault_secret_field" AS ENUM('username', 'password', 'totp', 'pin', 'imap_password', 'passkey');--> statement-breakpoint
CREATE TYPE "public"."wait_reason" AS ENUM('approval', 'takeover', 'captcha', 'otp');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"default_budget" jsonb DEFAULT '{"maxSteps":150,"maxUsd":5,"maxActiveMinutes":60}'::jsonb NOT NULL,
	"default_allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"concurrency" integer DEFAULT 6 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_concurrency_positive" CHECK ("settings"."concurrency" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_user_uq" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_workspace_sha256_uq" UNIQUE("workspace_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folders_workspace_parent_name_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","parent_id","name"),
	CONSTRAINT "folders_name_valid" CHECK (length(btrim("folders"."name")) between 1 and 120 and position('/' in "folders"."name") = 0)
);
--> statement-breakpoint
CREATE TABLE "note_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"position" text NOT NULL,
	"type" "block_type" NOT NULL,
	"markdown" text NOT NULL,
	"asset_id" uuid,
	"source_id" uuid,
	"origin" "block_origin" NOT NULL,
	"anchor" jsonb,
	"content_sha256" text,
	"verified" boolean DEFAULT false NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"original_markdown" text,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_blocks_note_position_uq" UNIQUE("note_id","position")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"filed_by" "filed_by" DEFAULT 'agent' NOT NULL,
	"run_id" uuid,
	"title" text NOT NULL,
	"lede" text,
	"fidelity" "fidelity" DEFAULT 'needs_review' NOT NULL,
	"coverage" double precision,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce("title", '') || ' ' || coalesce("lede", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text,
	"origin" text NOT NULL,
	"title" text,
	"favicon_asset_id" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mhtml_key" text,
	"screenshot_key" text,
	"snapshot_sha256" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_seq" integer NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"request" jsonb NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"edit" jsonb,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_slots" (
	"name" text PRIMARY KEY NOT NULL,
	"state" "slot_state" DEFAULT 'restarting' NOT NULL,
	"run_id" uuid,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"restarted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_slots_run_uq" UNIQUE("run_id"),
	CONSTRAINT "browser_slots_name_valid" CHECK ("browser_slots"."name" ~ '^browser-[1-9][0-9]?$')
);
--> statement-breakpoint
CREATE TABLE "downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"asset_id" uuid,
	"bytes" bigint NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"phase" "step_phase" NOT NULL,
	"state" "step_state" NOT NULL,
	"action" jsonb,
	"result" jsonb,
	"caption" text,
	"url" text,
	"screenshot_key" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_seq_uq" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "run_transcript" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"item" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_transcript_run_seq_uq" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"wait_reason" "wait_reason",
	"controller" "controller" DEFAULT 'agent' NOT NULL,
	"approval_mode" "approval_mode" DEFAULT 'ask' NOT NULL,
	"model" text DEFAULT 'gpt-6-astra' NOT NULL,
	"previous_response_id" text,
	"plan" jsonb,
	"budget" jsonb DEFAULT '{"maxSteps":150,"maxUsd":5,"maxActiveMinutes":60}'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{"steps":0,"inputTokens":0,"cachedInputTokens":0,"outputTokens":0,"usd":0,"activeMs":0}'::jsonb NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"target_folder_id" uuid,
	"note_id" uuid,
	"slot_name" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"wake_requested_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"current_url" text,
	"scroll" jsonb,
	"video_time" double precision,
	"error" jsonb,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_slot_name_uq" UNIQUE("slot_name"),
	CONSTRAINT "runs_wait_reason_matches_status" CHECK (("runs"."status" = 'waiting') = ("runs"."wait_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"origin" text NOT NULL,
	"sealed_state" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_sessions_workspace_alias_origin_uq" UNIQUE("workspace_id","alias","origin")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid,
	"sealed" "bytea" NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '5 minutes' NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_id" uuid,
	"alias" text NOT NULL,
	"origin" text,
	"field" text,
	"action" "vault_audit_action" NOT NULL,
	"run_id" uuid,
	"approved_by" text,
	"outcome" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_grants_item_origin_uq" UNIQUE("item_id","origin")
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"origin" text NOT NULL,
	"label" text NOT NULL,
	"fields" "vault_secret_field"[] DEFAULT '{}' NOT NULL,
	"imap" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_items_workspace_alias_uq" UNIQUE("workspace_id","alias"),
	CONSTRAINT "vault_items_alias_valid" CHECK ("vault_items"."alias" ~ '^[a-z0-9][a-z0-9_-]{0,62}$')
);
--> statement-breakpoint
CREATE TABLE "vault_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"field" "vault_secret_field" NOT NULL,
	"sealed" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_secrets_item_field_uq" UNIQUE("item_id","field")
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"run_id" uuid,
	"outcome" "benchmark_outcome" DEFAULT 'pending' NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" bigint,
	"failure_notes" text,
	"graded_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_runs_run_uq" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"task" text NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"approval_mode" "approval_mode" DEFAULT 'auto_within_allowlist' NOT NULL,
	"budget" jsonb DEFAULT '{"maxSteps":150,"maxUsd":5,"maxActiveMinutes":60}'::jsonb NOT NULL,
	"success_criteria" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmarks_workspace_name_uq" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_blocks" ADD CONSTRAINT "note_blocks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_blocks" ADD CONSTRAINT "note_blocks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_blocks" ADD CONSTRAINT "note_blocks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_favicon_asset_id_assets_id_fk" FOREIGN KEY ("favicon_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_slots" ADD CONSTRAINT "browser_slots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_transcript" ADD CONSTRAINT "run_transcript_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_target_folder_id_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_slot_name_browser_slots_name_fk" FOREIGN KEY ("slot_name") REFERENCES "public"."browser_slots"("name") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_item_id_vault_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_grants" ADD CONSTRAINT "vault_grants_item_id_vault_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_secrets" ADD CONSTRAINT "vault_secrets_item_id_vault_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_benchmark_id_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "note_blocks_embedding_idx" ON "note_blocks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "notes_workspace_folder_idx" ON "notes" USING btree ("workspace_id","folder_id");--> statement-breakpoint
CREATE INDEX "notes_run_idx" ON "notes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search");--> statement-breakpoint
CREATE INDEX "approvals_run_status_idx" ON "approvals" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "runs_claim_idx" ON "runs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_created_idx" ON "runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "vault_audit_workspace_at_idx" ON "vault_audit" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "benchmark_runs_benchmark_started_idx" ON "benchmark_runs" USING btree ("benchmark_id","started_at");