ALTER TABLE "note_blocks" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, "markdown")) STORED;--> statement-breakpoint
CREATE INDEX "note_blocks_search_idx" ON "note_blocks" USING gin ("search");--> statement-breakpoint
CREATE INDEX "sources_note_idx" ON "sources" USING btree ("workspace_id",("meta"->>'noteId'));