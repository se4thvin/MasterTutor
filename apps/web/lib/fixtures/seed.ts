import { createHash } from "node:crypto";
import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  MODELS,
  type Anchor,
  type BlockOrigin,
  type BlockType,
  type Fidelity,
  type FolderView,
  type NoteBlock,
  type RunStatus,
  type RunSummary,
  type SourceKind,
  type SourceView,
  type VaultAuditAction,
  type VaultAuditView,
  type VaultItemView,
  type VaultSecretField,
} from "@mastertutor/contracts";
import { ids } from "./ids.ts";
import { recordedSummary } from "./run-recording.ts";
import type { FixtureState, NoteRecord } from "./types.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const at = (day: string, time = "17:00:00") => `${day}T${time}.000Z`;
const anchor = (partial: Partial<Anchor> = {}): Anchor => ({
  selector: null,
  xpath: null,
  start: null,
  end: null,
  textFragment: null,
  ...partial,
});

interface BlockSeed {
  type: BlockType;
  markdown: string;
  origin?: BlockOrigin;
  verified?: boolean;
  anchor?: Anchor | null;
  assetId?: string;
  edited?: { original: string };
}

let blockCounter = 0;
function blocks(
  noteId: string,
  sourceId: string,
  capturedAt: string,
  seeds: BlockSeed[],
): NoteBlock[] {
  return seeds.map((seed, i) => {
    blockCounter += 1;
    const origin = seed.origin ?? "dom";
    return {
      id: ids.block(blockCounter),
      noteId,
      position: `a${String(i).padStart(4, "0")}`,
      type: seed.type,
      markdown: seed.markdown,
      assetId: seed.assetId ?? null,
      sourceId: origin === "model" ? null : sourceId,
      origin,
      anchor: origin === "model" ? null : (seed.anchor ?? anchor()),
      contentSha256: sha(seed.edited?.original ?? seed.markdown),
      verified: seed.verified ?? origin !== "ocr_model",
      edited: Boolean(seed.edited),
      originalMarkdown: seed.edited?.original ?? null,
      createdAt: capturedAt,
    };
  });
}

function source(
  n: number,
  kind: SourceKind,
  url: string,
  title: string,
  capturedAt: string,
  faviconAssetId: string | null = null,
): SourceView {
  return {
    id: ids.source(n),
    kind,
    url,
    canonicalUrl: url,
    origin: new URL(url).origin,
    title,
    faviconAssetId,
    capturedAt,
  };
}

interface NoteSeed {
  n: number;
  title: string;
  lede: string | null;
  folderId: string | null;
  fidelity: Fidelity;
  coverage: number | null;
  createdAt: string;
  source: SourceView;
  blocks: BlockSeed[];
  runId?: string;
  /** Content the capture lost (keyframes, regions), as sources.meta.mediaLost records it. */
  mediaLost?: number;
}

function note(seed: NoteSeed): NoteRecord {
  const noteId = ids.note(seed.n);
  return {
    note: {
      id: noteId,
      folderId: seed.folderId,
      title: seed.title,
      lede: seed.lede,
      fidelity: seed.fidelity,
      coverage: seed.coverage,
      filedBy: "agent",
      runId: seed.runId ?? null,
      sourceKinds: [seed.source.kind],
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
    },
    blocks: blocks(noteId, seed.source.id, seed.source.capturedAt, seed.blocks),
    sources: [seed.source],
    ...(seed.mediaLost ? { mediaLost: seed.mediaLost } : {}),
  };
}

const para = (markdown: string, fragment?: string): BlockSeed => ({
  type: "paragraph",
  markdown,
  anchor: anchor({ selector: "article > p", textFragment: fragment ?? markdown.slice(0, 40) }),
});

const WARMUP: BlockSeed[] = [
  para(
    "Training a transformer with Adam at its full learning rate from step zero often diverges within the first few thousand steps. Warmup, a short ramp from near-zero to the peak rate, is the cheapest fix we know.",
    "Training a transformer with Adam",
  ),
  {
    type: "heading",
    markdown: "## The update rule",
    anchor: anchor({ selector: "article > h2:nth-of-type(1)", textFragment: "The update rule" }),
  },
  para(
    "Adam scales each step by a running estimate of the gradient's second moment. Early in training that estimate rests on a handful of samples, so the effective step can be huge.",
  ),
  {
    type: "math",
    markdown:
      "$$\n\\theta_{t+1} = \\theta_t - \\eta_t \\cdot \\frac{\\hat m_t}{\\sqrt{\\hat v_t} + \\epsilon}\n$$",
    anchor: anchor({ selector: "article > math#eq-1" }),
  },
  { type: "heading", markdown: "## Common schedules" },
  {
    type: "table",
    markdown:
      "| Schedule | Warmup | Decay | Typical use |\n| --- | --- | --- | --- |\n| Linear + cosine | 2,000 steps | cosine to 10% of peak | LLM pretraining |\n| Inverse square root | 4,000 steps | ∝ 1/√t | Original Transformer (2017) |\n| Warmup-stable-decay | 1% of steps | linear, final 10% | Continual pretraining |\n| Constant | none | none | Small fine-tunes |",
    anchor: anchor({ selector: "article > table:nth-of-type(1)" }),
  },
  { type: "heading", markdown: "## In code" },
  {
    type: "code",
    markdown:
      "```python\nimport math\n\ndef lr_at(step, max_lr=3e-4, warmup=2_000, total=100_000):\n    if step < warmup:\n        return max_lr * step / warmup\n    progress = (step - warmup) / (total - warmup)\n    return max_lr * (0.1 + 0.45 * (1 + math.cos(math.pi * progress)))\n```",
    anchor: anchor({ selector: "article > pre:nth-of-type(1)" }),
  },
  {
    type: "figure",
    markdown:
      "**Figure 2.** Warmup, then cosine decay. The rate climbs linearly for 2,000 steps, then falls to 10% of its peak by step 100k.",
    assetId: ids.asset(1),
    anchor: anchor({ selector: "article > figure#fig-2" }),
  },
  {
    type: "image",
    markdown: "Training log screenshot",
    assetId: ids.asset(2),
    anchor: anchor({ selector: "article > img[alt='training_log.png']" }),
  },
  {
    type: "code",
    markdown:
      "```text\nstep 1399 | loss 2.871\nstep 1400 | loss 2.913 | grad_norm 1.2e+04\nstep 1401 | loss nan\n```",
    origin: "ocr_model",
  },
  {
    type: "paragraph",
    markdown:
      "**In practice:** warm up for about 1–2% of total steps, longer if you raise the batch size or the peak rate.",
    edited: {
      original:
        "In practice: warm up for about 1–2% of total steps. Go longer if you raise the batch size or the peak rate, as most papers do.",
    },
  },
  {
    type: "list",
    markdown:
      "- Ramp linearly; the exact shape matters less than the length.\n- Scale warmup with batch size.\n- Re-warm after loading a checkpoint with a fresh optimizer.",
  },
  {
    type: "quote",
    markdown: "> Every large run you've read about uses warmup, and almost nobody says why.",
  },
  {
    type: "table",
    markdown:
      '<table><thead><tr><th>Run</th><th>Warmup</th><th>Result</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>0</td><td>diverged at 1.4k</td></tr><tr><td>2k</td><td>converged</td></tr></tbody></table>',
  },
  {
    type: "commentary",
    markdown: "The talk in *Why warmup works* shows the same NaN at step 1,401, live.",
    origin: "model",
  },
];

const TALK: BlockSeed[] = [
  {
    type: "heading",
    markdown: "## Why warmup exists",
    origin: "captions",
    anchor: anchor({ tStart: 0, tEnd: 192 }),
  },
  {
    type: "transcript",
    markdown: "Every large run you've read about uses it, and almost nobody says why.",
    origin: "captions",
    anchor: anchor({ tStart: 4, tEnd: 9 }),
  },
  {
    type: "heading",
    markdown: "## Adam's second moment at t = 1",
    origin: "captions",
    anchor: anchor({ tStart: 192, tEnd: 465 }),
  },
  {
    type: "transcript",
    markdown:
      "With one sample, the second-moment estimate is just the squared gradient, so the denominator is noise.",
    origin: "captions",
    anchor: anchor({ tStart: 198, tEnd: 206 }),
  },
  {
    type: "keyframe",
    markdown: "Loss curve with a spike at step 1,400",
    assetId: ids.asset(3),
    anchor: anchor({ tStart: 768, tEnd: 768 }),
  },
  {
    type: "transcript",
    markdown: "Here's the NaN at step 1,401, on screen.",
    origin: "asr",
    anchor: anchor({ tStart: 770, tEnd: 774 }),
  },
];

const pdfBlock = (markdown: string, page: number): BlockSeed => ({
  type: markdown.startsWith("#") ? "heading" : "paragraph",
  markdown,
  origin: "pdf",
  anchor: anchor({ page, bbox: { x: 72, y: 120, width: 468, height: 64 } }),
});

const LONG_TITLE =
  "Pneumonoultramicroscopicsilicovolcanoconiosis_and_other_unbroken_strings_that_must_never_push_the_layout_sideways_even_on_a_phone_" +
  "x".repeat(70);

function folders(): FolderView[] {
  const f = (n: number, name: string, parent: number | null, sort: number): FolderView => ({
    id: ids.folder(n),
    parentId: parent === null ? null : ids.folder(parent),
    name,
    sort,
  });
  return [
    f(1, "Machine learning", null, 0),
    f(2, "Optimization", 1, 0),
    f(3, "Schedulers", 2, 0),
    f(4, "Papers", 1, 1),
    f(5, "Databases", null, 1),
    f(6, "Coursework", null, 2),
    f(7, "EE 2310", 6, 0),
  ];
}

function notes(): NoteRecord[] {
  blockCounter = 0;
  const simple = (lines: string[]): BlockSeed[] =>
    lines.map((line) => (line.startsWith("##") ? { type: "heading", markdown: line } : para(line)));
  return [
    note({
      n: 1,
      title: "Learning-rate warmup, explained",
      lede: "Why a short ramp at the start keeps Adam from diverging, and how long to make it.",
      folderId: ids.folder(2),
      fidelity: "needs_review",
      coverage: 0.99,
      createdAt: at("2026-10-05", "17:10:00"),
      runId: ids.run(2),
      source: source(
        1,
        "web",
        "https://fieldnotes.ml/posts/learning-rate-warmup",
        "Learning-rate warmup, explained",
        at("2026-10-05", "17:09:41"),
        ids.asset(4),
      ),
      blocks: WARMUP,
    }),
    note({
      n: 2,
      title: "Why warmup works (talk)",
      lede: "Optimization Reading Group, 24 minutes, chaptered with keyframes.",
      folderId: ids.folder(2),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-05", "16:40:00"),
      source: source(
        2,
        "youtube",
        "https://www.youtube.com/watch?v=k3Wm9xTq2aE",
        "Why warmup works",
        at("2026-10-05", "16:39:00"),
      ),
      blocks: TALK,
    }),
    note({
      n: 3,
      title: "Attention Is All You Need",
      lede: "The original Transformer paper, text and figures from the PDF.",
      folderId: ids.folder(4),
      fidelity: "partial",
      coverage: 0.96,
      createdAt: at("2026-10-04"),
      source: source(
        3,
        "pdf",
        "https://arxiv.org/pdf/1706.03762",
        "Attention Is All You Need",
        at("2026-10-04"),
      ),
      blocks: [
        pdfBlock("## Abstract", 1),
        pdfBlock(
          "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
          1,
        ),
        pdfBlock("## 3 Model Architecture", 2),
        pdfBlock(
          "Most competitive neural sequence transduction models have an encoder-decoder structure.",
          2,
        ),
      ],
    }),
    note({
      n: 4,
      title: "FOR UPDATE SKIP LOCKED",
      lede: "Queue-style row claiming in PostgreSQL.",
      folderId: ids.folder(5),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-03"),
      source: source(
        4,
        "web",
        "https://www.postgresql.org/docs/17/sql-select.html",
        "SELECT",
        at("2026-10-03"),
      ),
      blocks: simple([
        "## The locking clause",
        "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped.",
      ]),
    }),
    note({
      n: 5,
      title: "Postgres LISTEN/NOTIFY",
      lede: "Asynchronous notifications between sessions.",
      folderId: ids.folder(5),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-02"),
      source: source(
        5,
        "web",
        "https://www.postgresql.org/docs/17/sql-notify.html",
        "NOTIFY",
        at("2026-10-02"),
      ),
      blocks: simple([
        "## Payloads",
        "The payload must be shorter than 8000 bytes in the default configuration.",
      ]),
    }),
    note({
      n: 6,
      title: "Reading 1: Introduction to circuits",
      lede: "Charge, current and voltage, with the participation activities' key facts.",
      folderId: ids.folder(7),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-10-01"),
      source: source(
        6,
        "web",
        "https://learn.example.edu/book/ee2310/chapter/1/section/1",
        "1.1 Circuits",
        at("2026-10-01"),
      ),
      blocks: simple([
        "## Charge",
        "Charge is measured in coulombs.",
        "## Current",
        "Current is the rate of flow of charge.",
      ]),
    }),
    note({
      n: 7,
      title: "Cosine schedules in practice",
      lede: "Where the decay floor matters.",
      folderId: ids.folder(3),
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-09-30"),
      source: source(
        7,
        "web",
        "https://fieldnotes.ml/posts/cosine-schedules",
        "Cosine schedules",
        at("2026-09-30"),
      ),
      blocks: simple([
        "Cosine decay to 10% of peak is a safe default.",
        // Inline figure and file link as B2 writes them: asset:<id> targets inside block Markdown.
        `![Cosine decay to a 10% floor](asset:${ids.asset(1)}) See the [full-size figure](asset:${ids.asset(1)}).`,
      ]),
    }),
    note({
      n: 8,
      title: "Unfiled clipping",
      lede: "A page the agent could not place.",
      folderId: null,
      fidelity: "partial",
      coverage: 0.9,
      createdAt: at("2026-09-29"),
      source: source(8, "web", "https://example.org/clipping", "Clipping", at("2026-09-29")),
      blocks: simple(["Only part of this page could be verified."]),
    }),
    note({
      n: 9,
      title: "Kirchhoff's laws (lecture)",
      lede: "Lecture video with captions checked against audio.",
      folderId: ids.folder(7),
      fidelity: "needs_review",
      coverage: 0.99,
      // One keyframe was withheld: verifying the transcript leaves the note partial, never verified.
      mediaLost: 1,
      createdAt: at("2026-09-28"),
      source: source(
        9,
        "youtube",
        "https://www.youtube.com/watch?v=Kirchhoff01",
        "Kirchhoff's laws",
        at("2026-09-28"),
      ),
      blocks: [
        {
          type: "transcript",
          markdown: "The sum of currents into a node is zero.",
          origin: "asr",
          verified: false,
          anchor: anchor({ tStart: 61, tEnd: 66 }),
        },
      ],
    }),
    note({
      n: 10,
      title: LONG_TITLE,
      lede: "https://a-really-long-subdomain-name-for-testing.example-university.edu/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all",
      folderId: null,
      fidelity: "verified",
      coverage: 1,
      createdAt: at("2026-09-27"),
      source: source(
        10,
        "web",
        "https://a-really-long-subdomain-name-for-testing.example-university.edu/a/very/long/path/that/keeps/going",
        LONG_TITLE,
        at("2026-09-27"),
      ),
      blocks: [
        para(`Unbroken: ${"averyveryverylongwordwithoutanybreaks".repeat(6)}`),
        { type: "code", markdown: `\`\`\`text\n${"x".repeat(240)}\n\`\`\`` },
        {
          type: "table",
          markdown: `| ${Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`).join(" | ")} |\n| ${Array.from({ length: 12 }, () => "---").join(" | ")} |\n| ${Array.from({ length: 12 }, (_, i) => `value-${i + 1}-longish`).join(" | ")} |`,
        },
      ],
    }),
  ];
}

function vault(): VaultItemView[] {
  const item = (
    n: number,
    alias: string,
    origin: string,
    label: string,
    fields: VaultSecretField[],
    hasImap: boolean,
    sessionSaved: boolean,
  ): VaultItemView => ({
    id: ids.vault(n),
    alias,
    origin,
    label,
    fields,
    hasImap,
    sessionSaved,
    createdAt: at("2026-09-20"),
  });
  return [
    item(
      1,
      "github",
      "https://github.com",
      "GitHub",
      ["username", "password", "totp"],
      false,
      true,
    ),
    item(
      2,
      "uni-portal",
      "https://portal.example.edu",
      "University portal",
      ["username", "pin"],
      false,
      false,
    ),
    item(
      3,
      "jstor",
      "https://www.jstor.org",
      "JSTOR",
      ["username", "password", "imap_password"],
      true,
      false,
    ),
    item(4, "medium", "https://medium.com", "Medium", ["passkey"], false, true),
    item(
      5,
      "a-very-long-alias-for-layout-testing-0123456789-abcdefghijklmno",
      "https://a-really-long-subdomain-name-for-testing.example-university.edu",
      "Long names",
      ["username", "password"],
      false,
      false,
    ),
  ];
}

function audit(): VaultAuditView[] {
  const actions: VaultAuditAction[] = [
    "fill",
    "fill",
    "create",
    "update",
    "passkey",
    "otp_received",
    "denied",
    "delete",
  ];
  const aliases = ["github", "uni-portal", "jstor", "medium"];
  const fields = ["password", "username", null, "pin", null, "otp", "password", null];
  return Array.from({ length: 60 }, (_, i) => {
    const action = actions[i % actions.length] ?? "fill";
    const alias = aliases[i % aliases.length] ?? "github";
    const minutes = String(59 - (i % 60)).padStart(2, "0");
    return {
      id: ids.audit(i + 1),
      alias,
      origin: alias === "github" ? "https://github.com" : null,
      field: fields[i % fields.length] ?? null,
      action,
      runId: action === "fill" || action === "denied" ? ids.run(1) : null,
      approvedBy: action === "fill" ? "Sam Lee" : null,
      outcome: action === "denied" ? "origin mismatch" : "ok",
      at: `2026-10-${String(5 - Math.floor(i / 20)).padStart(2, "0")}T16:${minutes}:00.000Z`,
    };
  });
}

function runs(): RunSummary[] {
  const run = (
    n: number,
    goal: string,
    title: string,
    status: RunStatus,
    usd: number,
    steps: number,
    createdAt: string,
    finishedAt: string | null,
    noteId: string | null,
  ): RunSummary => ({
    id: ids.run(n),
    goal,
    title,
    status,
    waitReason: null,
    controller: "agent",
    approvalMode: "ask",
    toolProfile: "browser_use",
    model: MODELS.agentPrimary,
    noteId,
    usage: { ...EMPTY_USAGE, steps, usd },
    budget: DEFAULT_BUDGET,
    createdAt,
    finishedAt,
  });
  return [
    recordedSummary(),
    run(
      2,
      "Capture the learning-rate warmup article verbatim",
      "Learning-rate warmup, verbatim",
      "completed",
      1.12,
      41,
      at("2026-10-05", "17:00:00"),
      at("2026-10-05", "17:10:00"),
      ids.note(1),
    ),
  ];
}

export function createSeed(): FixtureState {
  return {
    folders: folders(),
    notes: notes(),
    vault: vault(),
    audit: audit(),
    settings: {
      killSwitch: false,
      defaultBudget: DEFAULT_BUDGET,
      defaultAllowedOrigins: [],
      concurrency: 6,
      version: "1",
    },
    runs: runs(),
    runScope: {},
    decidedApprovals: [],
  };
}
