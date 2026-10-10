CREATE TABLE "capture_preferences" (
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"brief" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capture_preferences_workspace_id_domain_pk" PRIMARY KEY("workspace_id","domain")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "capture_brief" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "capture_question" jsonb;--> statement-breakpoint
ALTER TABLE "capture_preferences" ADD CONSTRAINT "capture_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;