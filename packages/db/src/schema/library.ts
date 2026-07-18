import { EMBEDDING_DIMENSIONS, type Anchor } from "@mastertutor/contracts";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { createdAt, id, tstz, tsvector, updatedAt } from "./columns.ts";
import {
  blockOriginEnum,
  blockTypeEnum,
  fidelityEnum,
  filedByEnum,
  sourceKindEnum,
} from "./enums.ts";
import { workspaces } from "./workspace.ts";

const workspaceRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const assets = pgTable(
  "assets",
  {
    id: id(),
    workspaceId: workspaceRef(),
    sha256: text("sha256").notNull(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    mime: text("mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    sourceUrl: text("source_url"),
    createdAt: createdAt(),
  },
  (t) => [unique("assets_workspace_sha256_uq").on(t.workspaceId, t.sha256)],
);

/** Depth <= 8, no cycles, same-workspace parent: enforced by trigger folders_check_tree (0002). */
export const folders = pgTable(
  "folders",
  {
    id: id(),
    workspaceId: workspaceRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("folders_workspace_parent_name_uq")
      .on(t.workspaceId, t.parentId, t.name)
      .nullsNotDistinct(),
    index("folders_parent_idx").on(t.parentId),
    check(
      "folders_name_valid",
      sql`length(btrim(${t.name})) between 1 and 120 and position('/' in ${t.name}) = 0`,
    ),
  ],
);

export const sources = pgTable("sources", {
  id: id(),
  workspaceId: workspaceRef(),
  kind: sourceKindEnum("kind").notNull(),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url"),
  origin: text("origin").notNull(),
  title: text("title"),
  faviconAssetId: uuid("favicon_asset_id").references(() => assets.id, { onDelete: "set null" }),
  capturedAt: tstz("captured_at").notNull().defaultNow(),
  mhtmlKey: text("mhtml_key"),
  screenshotKey: text("screenshot_key"),
  snapshotSha256: text("snapshot_sha256"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const notes = pgTable(
  "notes",
  {
    id: id(),
    workspaceId: workspaceRef(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    filedBy: filedByEnum("filed_by").notNull().default("agent"),
    /** No FK: runs references notes, and notes outlive pruning anyway. */
    runId: uuid("run_id"),
    title: text("title").notNull(),
    lede: text("lede"),
    fidelity: fidelityEnum("fidelity").notNull().default("needs_review"),
    coverage: doublePrecision("coverage"),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce("title", '') || ' ' || coalesce("lede", ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notes_workspace_folder_idx").on(t.workspaceId, t.folderId),
    index("notes_run_idx").on(t.runId),
    index("notes_search_idx").using("gin", t.search),
  ],
);

export const noteBlocks = pgTable(
  "note_blocks",
  {
    id: id(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    type: blockTypeEnum("type").notNull(),
    markdown: text("markdown").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    origin: blockOriginEnum("origin").notNull(),
    anchor: jsonb("anchor").$type<Anchor>(),
    contentSha256: text("content_sha256"),
    verified: boolean("verified").notNull().default(false),
    edited: boolean("edited").notNull().default(false),
    originalMarkdown: text("original_markdown"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /** Full-text over block Markdown (B2; Phase 0 note 6). Generated, never written. */
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, "markdown")`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    unique("note_blocks_note_position_uq").on(t.noteId, t.position),
    index("note_blocks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("note_blocks_search_idx").using("gin", t.search),
  ],
);
