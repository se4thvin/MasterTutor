ALTER TABLE "downloads" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "downloads" ADD COLUMN "kept_at" timestamp with time zone;