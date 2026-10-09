-- D55.1: notes contain captured source text and the user's writing only.
DELETE FROM "note_blocks" WHERE "origin" = 'model';--> statement-breakpoint
ALTER TABLE "note_blocks" ALTER COLUMN "origin" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."block_origin";--> statement-breakpoint
CREATE TYPE "public"."block_origin" AS ENUM('dom', 'pdf', 'captions', 'asr', 'ocr_model', 'user');--> statement-breakpoint
ALTER TABLE "note_blocks" ALTER COLUMN "origin" SET DATA TYPE "public"."block_origin" USING "origin"::"public"."block_origin";
