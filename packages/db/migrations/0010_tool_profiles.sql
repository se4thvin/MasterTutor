CREATE TYPE "public"."tool_profile" AS ENUM('browser_use', 'computer_use');--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tool_profile" "tool_profile" DEFAULT 'browser_use' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD COLUMN "takeovers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmarks" ADD COLUMN "tool_profile" "tool_profile" DEFAULT 'browser_use' NOT NULL;