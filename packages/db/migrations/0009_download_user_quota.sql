ALTER TABLE "downloads" ADD COLUMN "by_user" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "downloads" ADD COLUMN "discarded_at" timestamp with time zone;--> statement-breakpoint
-- Rows a person made before this column: held ones, and ones they kept.
UPDATE "downloads" SET "by_user" = true WHERE "pending" OR "kept_at" IS NOT NULL;
