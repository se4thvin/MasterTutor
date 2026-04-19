ALTER TABLE "runs" ADD COLUMN "control_user_id" text;--> statement-breakpoint
-- Runs a user already held keep that state; "legacy" marks the holder as unknown (owners can hand back).
UPDATE "runs" SET "control_user_id" = 'legacy' WHERE "controller" = 'user';--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_control_user_matches_controller" CHECK (("runs"."controller" = 'user') = ("runs"."control_user_id" is not null));