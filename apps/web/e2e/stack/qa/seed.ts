/**
 * Deterministic QA data for the Phase 8 screen catalog (spec §12, D22): every run-view state, every
 * approval kind, a bypass decision, a download, a nested library with every block origin, vault and
 * audit rows. Prints SQL for psql (scripts/qa-stack.sh); needs T1's owner (support/env.ts OWNER)
 * signed up.
 *
 * Every jsonb value is parsed with its contract schema first, and the two runs CHECKs are derived,
 * not typed in, so the seed cannot drift from what the app reads or the schema allows (P8-6).
 */
import {
  Anchor,
  APPROVAL_KINDS,
  ApprovalRequest,
  BYPASS_DECIDER,
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  Plan,
  RunError,
  RunEvent,
  StepAction,
  TERMINAL_RUN_STATUSES,
  Usage,
  type ApprovalKind,
  type ApprovalMode,
  type BlockOrigin,
  type BlockType,
  type Controller,
  type RunStatus,
  type StepPhase,
  type WaitReason,
} from "@mastertutor/contracts";
import { OWNER } from "../support/env.ts";

/** The QA clock: Playwright pins Date.now here, so relative times on screen never change. */
export const QA_NOW = new Date("2026-10-05T15:00:00Z");

const id = (n: number) => `0a000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const byKind = (base: number): Record<ApprovalKind, string> =>
  Object.fromEntries(APPROVAL_KINDS.map((kind, i) => [kind, id(base + i)])) as Record<
    ApprovalKind,
    string
  >;

export const SEED = {
  folders: { research: id(0x01), papers: id(0x02), video: id(0x03), empty: id(0x04) },
  sources: { article: id(0x10) },
  notes: { verified: id(0x20), review: id(0x21), missing: id(0x2f) },
  runs: {
    live: id(0x30),
    takeover: id(0x31),
    sleeping: id(0x32),
    queued: id(0x33),
    completed: id(0x34),
    failed: id(0x35),
    cancelled: id(0x36),
    otp: id(0x37),
    bypass: id(0x38),
    download: id(0x39),
  },
  approvalRuns: byKind(0x40),
  approvals: { ...byKind(0x50), bypassed: id(0x5f) },
  download: { asset: id(0x60), record: id(0x61) },
  vaultItem: id(0x70),
} as const;
export type RunKey = keyof typeof SEED.runs;

export const goalOf = (label: string) =>
  `QA ${label}: capture the Ada Lovelace article with its figures`;

// ---- SQL literals -------------------------------------------------------------------------------
const lit = (value: string) => `'${value.replaceAll("'", "''")}'`;
const opt = (value: string | null | undefined) => (value == null ? "null" : lit(value));
interface Schema<T> {
  parse(value: unknown): T;
}
const jsonb = <T>(schema: Schema<T>, value: T) =>
  `${lit(JSON.stringify(schema.parse(value)))}::jsonb`;
const at = (minutesAgo: number, seconds = 0) =>
  `timestamptz ${lit(new Date(QA_NOW.getTime() - minutesAgo * 60_000 + seconds * 1_000).toISOString())}`;
// T1's owner by email, never "the first owner": psql pointed at any other database finds no such
// user, so every insert fails on NOT NULL instead of writing into a real workspace (QA-040).
const OWNED = `from workspace_members join "user" on "user".id = user_id where email = ${lit(OWNER.email)} and role = 'owner'`;
const WS = `(select workspace_id ${OWNED})`;
const OWNER_ID = `(select user_id ${OWNED})`;

function insert(table: string, rows: readonly Record<string, string>[]): string {
  const columns = Object.keys(rows[0] ?? {});
  for (const row of rows) {
    if (Object.keys(row).join() !== columns.join())
      throw new Error(`${table}: rows differ in columns`);
  }
  const values = rows.map((row) => `(${columns.map((c) => row[c]).join(", ")})`).join(",\n  ");
  return `insert into ${table} (${columns.join(", ")}) values\n  ${values};`;
}

// ---- Shared values ------------------------------------------------------------------------------
const ARTICLE = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const PLAN: Plan = {
  items: [
    { text: "Open the article", done: true },
    { text: "Capture the page with its figures", done: true },
    { text: "File the note", done: false },
  ],
};
const usage = (steps: number, usd: number): Usage => ({
  steps,
  inputTokens: steps * 3_100,
  cachedInputTokens: steps * 2_400,
  outputTokens: steps * 120,
  usd,
  activeMs: steps * 4_100,
});
const STEPS: readonly { phase: StepPhase; caption: string; action: StepAction | null }[] = [
  { phase: "observe", caption: "Looked at the page", action: null },
  { phase: "decide", caption: "Decided to capture the article body", action: null },
  {
    phase: "act",
    caption: "Clicked “Read more” to expand the biography",
    action: {
      tool: "computer",
      summary: "Clicked “Read more” to expand the biography",
      point: { x: 640, y: 420 },
      pointer: "click",
    },
  },
  { phase: "observe", caption: "Checked that the expanded section loaded", action: null },
];
const APPROVAL_REQUESTS: Record<ApprovalKind, ApprovalRequest> = {
  risky_click: {
    kind: "risky_click",
    action: { type: "click", x: 640, y: 420, button: "left" },
    label: "Delete account",
    url: "https://en.wikipedia.org/wiki/Special:Preferences",
    screenshotKey: null,
  },
  form_submit: {
    kind: "form_submit",
    url: "https://en.wikipedia.org/wiki/Talk:Ada_Lovelace",
    formSummary: "Talk page comment: subject and message (2 fields)",
    screenshotKey: null,
  },
  download: {
    kind: "download",
    url: "https://arxiv.org/pdf/1706.03762.pdf",
    filename: "attention-is-all-you-need.pdf",
  },
  credential_first_use: {
    kind: "credential_first_use",
    alias: "university-portal",
    origin: "https://learn.example.edu",
  },
  new_origin: {
    kind: "new_origin",
    origin: "https://www.britannica.com",
    url: "https://www.britannica.com/biography/Ada-Lovelace",
  },
  budget: { kind: "budget", exceeded: "usd", usage: usage(61, 5.02), budget: DEFAULT_BUDGET },
  data_egress: {
    kind: "data_egress",
    action: { type: "type", text: "Ada Lovelace wrote the first published algorithm" },
    url: "https://www.britannica.com/search",
    fromOrigin: "https://en.wikipedia.org",
    toOrigin: "https://www.britannica.com",
    chars: 48,
    screenshotKey: null,
  },
  observer: {
    kind: "observer",
    verdict: "block",
    category: "unexpected_origin",
    rationale: "Opening a shopping site is unrelated to capturing the article.",
    subject: {
      kind: "new_origin",
      origin: "https://shop.example.com",
      url: "https://shop.example.com/cart",
    },
    url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
    screenshotKey: null,
  },
};

// ---- Runs ---------------------------------------------------------------------------------------
export interface SeedRun {
  id: string;
  label: string;
  status: RunStatus;
  waitReason: WaitReason | null;
  controller: Controller;
  approvalMode: ApprovalMode;
  slot: string | null;
  usage: Usage;
  error: RunError | null;
  noteId: string | null;
  minutesAgo: number;
  events: readonly RunEvent[];
  steps: boolean;
}

const status = (
  s: RunStatus,
  waitReason: WaitReason | null = null,
  reason: string | null = null,
): RunEvent => ({
  type: "status",
  status: s,
  waitReason,
  reason,
});

export function seedRuns(): readonly SeedRun[] {
  const base = {
    waitReason: null,
    controller: "agent",
    approvalMode: "ask",
    slot: null,
    usage: usage(42, 0.84),
    error: null,
    noteId: null,
    steps: true,
  } as const;
  const r = SEED.runs;
  const runs: SeedRun[] = [
    {
      ...base,
      id: r.live,
      label: "live",
      status: "running",
      slot: "browser-1",
      minutesAgo: 10,
      events: [status("running"), { type: "slot", slotName: "browser-1" }],
    },
    {
      ...base,
      id: r.takeover,
      label: "takeover",
      status: "waiting",
      waitReason: "takeover",
      controller: "user",
      minutesAgo: 12,
      events: [{ type: "control", holder: "user" }, status("waiting", "takeover")],
    },
    {
      ...base,
      id: r.sleeping,
      label: "sleeping",
      status: "sleeping",
      minutesAgo: 14,
      events: [status("sleeping", null, "Waiting for a free browser")],
    },
    {
      ...base,
      id: r.queued,
      label: "queued",
      status: "queued",
      usage: EMPTY_USAGE,
      steps: false,
      minutesAgo: 1,
      events: [status("queued")],
    },
    {
      ...base,
      id: r.completed,
      label: "completed",
      status: "completed",
      noteId: SEED.notes.verified,
      minutesAgo: 90,
      events: [
        {
          type: "filed",
          noteId: SEED.notes.verified,
          folderId: SEED.folders.papers,
          path: ["Research", "Papers with an unusually long folder name for wrapping"],
          filedBy: "agent",
        },
        status("completed"),
      ],
    },
    {
      ...base,
      id: r.failed,
      label: "failed",
      status: "failed",
      minutesAgo: 120,
      error: { code: "page_unreachable", message: "The site did not respond after 3 attempts." },
      events: [
        {
          type: "error",
          code: "page_unreachable",
          message: "The site did not respond after 3 attempts.",
        },
        status("failed"),
      ],
    },
    {
      ...base,
      id: r.cancelled,
      label: "cancelled",
      status: "cancelled",
      minutesAgo: 150,
      events: [status("cancelled", null, "Stopped by you")],
    },
    {
      ...base,
      id: r.otp,
      label: "otp",
      status: "waiting",
      waitReason: "otp",
      minutesAgo: 16,
      events: [status("waiting", "otp")],
    },
    {
      ...base,
      id: r.bypass,
      label: "bypass",
      status: "running",
      approvalMode: "bypass",
      minutesAgo: 18,
      events: [
        status("running"),
        {
          type: "approval_requested",
          approvalId: SEED.approvals.bypassed,
          request: APPROVAL_REQUESTS.risky_click,
        },
        {
          type: "approval_resolved",
          approvalId: SEED.approvals.bypassed,
          status: "approved",
          decidedBy: BYPASS_DECIDER,
        },
      ],
    },
    {
      ...base,
      id: r.download,
      label: "download",
      status: "completed",
      noteId: SEED.notes.verified,
      minutesAgo: 60,
      events: [
        {
          type: "download_ready",
          downloadId: SEED.download.record,
          assetId: SEED.download.asset,
          filename: "attention-is-all-you-need.pdf",
          bytes: 2_215_244,
        },
        status("completed"),
      ],
    },
    ...APPROVAL_KINDS.map((kind, i): SeedRun => ({
      ...base,
      id: SEED.approvalRuns[kind],
      label: `approval ${kind}`,
      status: "waiting",
      waitReason: "approval",
      usage: kind === "budget" ? usage(61, 5.02) : base.usage,
      minutesAgo: 20 + i,
      events: [
        status("waiting", "approval"),
        {
          type: "approval_requested",
          approvalId: SEED.approvals[kind],
          request: APPROVAL_REQUESTS[kind],
        },
      ],
    })),
  ];
  for (const run of runs) {
    // Mirrors the two runs CHECKs (0001, 0005) so a bad edit fails here, before Postgres.
    if ((run.status === "waiting") !== (run.waitReason !== null)) {
      throw new Error(`${run.label}: a wait reason goes with status waiting only`);
    }
  }
  return runs;
}

function runRow(run: SeedRun): Record<string, string> {
  const terminal = (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(run.status);
  return {
    id: lit(run.id),
    workspace_id: WS,
    goal: lit(goalOf(run.label)),
    status: lit(run.status),
    wait_reason: opt(run.waitReason),
    controller: lit(run.controller),
    // runs_control_user_matches_controller (0005): set exactly when a person holds control (P8-6).
    control_user_id: run.controller === "user" ? OWNER_ID : "null",
    approval_mode: lit(run.approvalMode),
    plan: jsonb(Plan, PLAN),
    usage: jsonb(Usage, run.usage),
    allowed_origins: "array['https://en.wikipedia.org']",
    current_url: run.status === "queued" ? "null" : lit(ARTICLE),
    slot_name: opt(run.slot),
    lease_owner: run.slot ? lit("qa-seed") : "null",
    lease_expires_at: run.slot ? "now() + interval '1 day'" : "null",
    last_activity_at: run.slot ? at(0) : "null",
    note_id: opt(run.noteId),
    error: run.error ? jsonb(RunError, run.error) : "null",
    finished_at: terminal ? at(run.minutesAgo - 4) : "null",
    created_at: at(run.minutesAgo),
  };
}

// ---- Library ------------------------------------------------------------------------------------
const anchor = (selector: string, end: number, fragment: string) =>
  jsonb(Anchor, { selector, xpath: null, start: 0, end, textFragment: fragment });

const BLOCKS: readonly {
  note: string;
  position: string;
  type: BlockType;
  markdown: string;
  origin: BlockOrigin;
  anchor: string;
  verified: boolean;
}[] = [
  {
    note: SEED.notes.verified,
    position: "a0",
    type: "heading",
    markdown: "## Early life",
    origin: "dom",
    anchor: anchor("#Early_life", 10, "Early%20life"),
    verified: true,
  },
  {
    note: SEED.notes.verified,
    position: "a1",
    type: "paragraph",
    origin: "dom",
    verified: true,
    markdown:
      "Lovelace was the only legitimate child of poet Lord Byron and reformer Anne Isabella Milbanke.",
    anchor: anchor("main p:nth-of-type(1)", 96, "Lovelace%20was%20the%20only"),
  },
  {
    note: SEED.notes.verified,
    position: "a2",
    type: "list",
    origin: "dom",
    anchor: "null",
    verified: true,
    markdown: "- The Analytical Engine\n- Bernoulli numbers\n- Note G",
  },
  {
    note: SEED.notes.verified,
    position: "a3",
    type: "quote",
    origin: "dom",
    anchor: "null",
    verified: true,
    markdown: "> That brain of mine is something more than merely mortal.",
  },
  {
    note: SEED.notes.verified,
    position: "a4",
    type: "code",
    origin: "dom",
    anchor: "null",
    verified: true,
    markdown: "```text\nv1 = v2 * v3\n```",
  },
  {
    note: SEED.notes.verified,
    position: "a5",
    type: "table",
    origin: "dom",
    anchor: "null",
    verified: true,
    markdown: "| Year | Event |\n|---|---|\n| 1843 | Notes published |",
  },
  {
    note: SEED.notes.verified,
    position: "a6",
    type: "math",
    origin: "dom",
    anchor: "null",
    verified: true,
    markdown: String.raw`$$B_n = -\sum_{k=0}^{n-1} \binom{n}{k} \frac{B_k}{n-k+1}$$`,
  },
  {
    note: SEED.notes.verified,
    position: "a7",
    type: "commentary",
    origin: "model",
    anchor: "null",
    verified: false,
    markdown: "Summary: the Notes contain what is often called the first published algorithm.",
  },
  {
    note: SEED.notes.review,
    position: "a0",
    type: "paragraph",
    origin: "ocr_model",
    anchor: "null",
    verified: false,
    markdown: "Diagram text transcribed from an image; please verify.",
  },
];

// ---- The script ---------------------------------------------------------------------------------
export function seedSql(): string {
  const runs = seedRuns();
  const f = SEED.folders;
  const n = SEED.notes;
  const statements = [
    insert("folders", [
      {
        id: lit(f.research),
        workspace_id: WS,
        parent_id: "null",
        name: lit("Research"),
        sort: "0",
      },
      {
        id: lit(f.video),
        workspace_id: WS,
        parent_id: "null",
        name: lit("Video lectures"),
        sort: "1",
      },
      {
        id: lit(f.empty),
        workspace_id: WS,
        parent_id: "null",
        name: lit("Empty folder"),
        sort: "2",
      },
    ]),
    // Children after parents, in their own statement: folders_check_tree (0002) looks the parent up.
    insert("folders", [
      {
        id: lit(f.papers),
        workspace_id: WS,
        parent_id: lit(f.research),
        name: lit("Papers with an unusually long folder name for wrapping"),
        sort: "0",
      },
    ]),
    insert("sources", [
      {
        id: lit(SEED.sources.article),
        workspace_id: WS,
        kind: lit("web"),
        url: lit(ARTICLE),
        canonical_url: lit(ARTICLE),
        origin: lit("https://en.wikipedia.org"),
        title: lit("Ada Lovelace - Wikipedia"),
        captured_at: at(95),
      },
    ]),
    insert("notes", [
      {
        id: lit(n.verified),
        workspace_id: WS,
        folder_id: lit(f.papers),
        filed_by: lit("agent"),
        run_id: lit(SEED.runs.completed),
        title: lit("Ada Lovelace"),
        lede: lit(
          "English mathematician and writer, chiefly known for her work on Charles Babbage's Analytical Engine.",
        ),
        fidelity: lit("verified"),
        coverage: "0.992",
        created_at: at(90),
        updated_at: at(90),
      },
      {
        id: lit(n.review),
        workspace_id: WS,
        folder_id: "null",
        filed_by: lit("user"),
        run_id: "null",
        title: lit(
          "Scanned lecture handout with a deliberately long title that must wrap gracefully at 390px",
        ),
        lede: "null",
        fidelity: lit("needs_review"),
        coverage: "0.71",
        created_at: at(200),
        updated_at: at(200),
      },
    ]),
    insert(
      "note_blocks",
      BLOCKS.map((b) => ({
        note_id: lit(b.note),
        position: lit(b.position),
        type: lit(b.type),
        markdown: lit(b.markdown),
        source_id: b.origin === "dom" ? lit(SEED.sources.article) : "null",
        origin: lit(b.origin),
        anchor: b.anchor,
        verified: String(b.verified),
      })),
    ),
    insert("runs", runs.map(runRow)),
    ...runs
      .filter((run) => run.slot !== null)
      .map(
        (run) =>
          `update browser_slots set state = 'leased', run_id = ${lit(run.id)}, lease_owner = 'qa-seed', ` +
          `lease_expires_at = now() + interval '1 day' where name = ${lit(run.slot!)};`,
      ),
    insert(
      "run_steps",
      runs
        .filter((run) => run.steps)
        .flatMap((run) =>
          STEPS.map((step, i) => ({
            run_id: lit(run.id),
            seq: String(i + 1),
            phase: lit(step.phase),
            state: lit("done"),
            caption: lit(step.caption),
            url: lit(ARTICLE),
            action: step.action ? jsonb(StepAction, step.action) : "null",
            created_at: at(run.minutesAgo, 20 * (i + 1)),
          })),
        ),
    ),
    insert("approvals", [
      ...APPROVAL_KINDS.map((kind) => ({
        id: lit(SEED.approvals[kind]),
        run_id: lit(SEED.approvalRuns[kind]),
        step_seq: "5",
        kind: lit(kind),
        request: jsonb(ApprovalRequest, APPROVAL_REQUESTS[kind]),
        status: lit("pending"),
        decided_by: "null",
        decided_at: "null",
      })),
      {
        id: lit(SEED.approvals.bypassed),
        run_id: lit(SEED.runs.bypass),
        step_seq: "3",
        kind: lit("risky_click"),
        request: jsonb(ApprovalRequest, APPROVAL_REQUESTS.risky_click),
        status: lit("approved"),
        decided_by: lit(BYPASS_DECIDER),
        decided_at: at(17),
      },
    ]),
    insert("assets", [
      {
        id: lit(SEED.download.asset),
        workspace_id: WS,
        sha256: lit("7".repeat(64)),
        bucket: lit("mastertutor"),
        key: lit(`downloads/${SEED.download.asset}.pdf`),
        mime: lit("application/pdf"),
        bytes: "2215244",
        source_url: lit("https://arxiv.org/pdf/1706.03762.pdf"),
      },
    ]),
    insert("downloads", [
      {
        id: lit(SEED.download.record),
        run_id: lit(SEED.runs.download),
        filename: lit("attention-is-all-you-need.pdf"),
        asset_id: lit(SEED.download.asset),
        bytes: "2215244",
        approved_by: OWNER_ID,
      },
    ]),
    insert(
      "run_events",
      runs.flatMap((run) =>
        run.events.map((event, i) => ({
          run_id: lit(run.id),
          type: lit(event.type),
          payload: jsonb(RunEvent, event),
          created_at: at(run.minutesAgo - 1, i),
        })),
      ),
    ),
    insert("vault_items", [
      {
        id: lit(SEED.vaultItem),
        workspace_id: WS,
        alias: lit("university-portal"),
        origin: lit("https://learn.example.edu"),
        label: lit("University portal (long label to test truncation)"),
        fields: "array['username','password','totp']::vault_secret_field[]",
      },
    ]),
    insert("browser_sessions", [
      {
        workspace_id: WS,
        alias: lit("university-portal"),
        origin: lit("https://learn.example.edu"),
        sealed_state: "decode('00', 'hex')",
      },
    ]),
    insert("vault_audit", [
      {
        workspace_id: WS,
        item_id: lit(SEED.vaultItem),
        alias: lit("university-portal"),
        origin: lit("https://learn.example.edu"),
        field: "null",
        action: lit("create"),
        run_id: "null",
        approved_by: OWNER_ID,
        outcome: lit("ok"),
        at: at(300),
      },
      {
        workspace_id: WS,
        item_id: lit(SEED.vaultItem),
        alias: lit("university-portal"),
        origin: lit("https://learn.example.edu"),
        field: lit("password"),
        action: lit("fill"),
        run_id: lit(SEED.runs.completed),
        approved_by: OWNER_ID,
        outcome: lit("ok"),
        at: at(88),
      },
    ]),
  ];
  return `begin;\n${statements.join("\n")}\ncommit;\n`;
}

if (import.meta.main) process.stdout.write(seedSql());
