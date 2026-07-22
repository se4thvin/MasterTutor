import { noteBlocks, notes, runs, sources } from "@mastertutor/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { FIXTURES } from "../testing/browser-harness.ts";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { seedRun } from "../testing/notes.ts";
import { createCaptureTool } from "./capture-tool.ts";
import { pageExtract } from "./page/extract.ts";
import { captureWorlds } from "./worlds.ts";

let env: CaptureEnv;
const signal = new AbortController().signal;
beforeAll(async () => {
  env = await startCaptureEnv();
}, 300_000);
afterAll(async () => {
  await env?.stop();
});

type Args = Parameters<ReturnType<typeof createCaptureTool>["run"]>[1];
const page: Args = { scope: "page", selector: null, kind: null };

async function capture(path: string, args: Args = page, mask?: MaskSources) {
  const scope = await seedRun(env.db.db);
  await env.session.goto(`${FIXTURES}/capture/${path}`, signal);
  const ctx = env.context(scope, mask);
  const result = await createCaptureTool(env.services).run(ctx, args);
  await env.commit(ctx);
  const blocks = await env.db.db
    .select()
    .from(noteBlocks)
    .where(eq(noteBlocks.noteId, result.noteId))
    .orderBy(sql`${noteBlocks.position} collate "C"`);
  const [source] = await env.db.db
    .select()
    .from(sources)
    .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
  return { scope, ctx, result, blocks, source: source! };
}

describe("capture tool (B2 done-when: ≥ 98% page coverage on fixtures)", () => {
  it.each(["article/index.html", "docs/index.html"])(
    "verifies %s against the whole page",
    async (path) => {
      const { result, source } = await capture(path);
      expect(result.coverage).toBeGreaterThanOrEqual(0.98);
      expect(result.fidelity).toBe("verified");
      expect(source.meta).toMatchObject({
        pageCoverage: result.coverage,
        rootCoverage: expect.any(Number),
        mediaLost: 0,
      });
      const [note] = await env.db.db.select().from(notes).where(eq(notes.id, result.noteId));
      expect(note).toMatchObject({ fidelity: "verified" });
    },
  );

  it("keeps docs structure, media blocks, TeX and anchors", async () => {
    const { blocks } = await capture("docs/index.html");
    expect(blocks.map((b) => b.type)).toEqual(
      expect.arrayContaining(["heading", "paragraph", "table", "code", "math", "image", "figure"]),
    );
    expect(blocks.find((b) => b.type === "code")?.markdown).toMatch(/^```python/);
    expect(blocks.some((b) => b.type === "table" && b.markdown.startsWith("<table>"))).toBe(true);
    expect(blocks.some((b) => b.markdown.includes("Count the carbon atoms"))).toBe(true);
    expect(blocks.some((b) => b.markdown.includes("Closed shadow note"))).toBe(true);
    expect(blocks.some((b) => b.markdown.includes("hidden paragraph"))).toBe(false);
    expect(blocks.find((b) => b.type === "math")?.verified).toBe(true);
    const paragraph = blocks.find((b) => b.markdown.startsWith("Cellular respiration converts"))!;
    expect(paragraph.anchor).toMatchObject({
      selector: expect.stringContaining("#content"),
      textFragment: expect.stringMatching(/^#:~:text=/),
    });
    expect(paragraph.verified).toBe(true);
    const diagram = blocks.find(
      (b) => b.type === "image" && b.markdown === "Labelled mitochondrion diagram",
    )!;
    expect(diagram.assetId).not.toBeNull();
    const [asset] = await env.db.db.execute(
      sql`select width from assets where id = ${diagram.assetId}`,
    );
    expect(asset?.width).toBe(1200);
    const figures = blocks.filter((b) => b.type === "figure");
    expect(figures).toHaveLength(2);
    for (const figure of figures) {
      expect(figure.assetId).not.toBeNull();
      expect(figure.markdown).toMatch(/\[Rendered view\]\(asset:[0-9a-f-]{36}\)/);
    }
  });

  it("stores the snapshot under the step and returns the same blocks on a repeat capture", async () => {
    const first = await capture("article/index.html");
    expect(first.source.mhtmlKey).toMatch(/^snapshots\/.+\/page\.mhtml$/);
    expect(await env.services.storage.head(first.source.screenshotKey!)).not.toBeNull();
    const again = await createCaptureTool(env.services).run(env.context(first.scope), page);
    expect(again.blockIds).toEqual(first.result.blockIds);
  });

  it("captures an element and refuses a missing selector with a typed error", async () => {
    const { result, blocks, ctx } = await capture("article/index.html", {
      scope: "element",
      selector: "article ol",
      kind: null,
    });
    expect(blocks.map((b) => b.type)).toEqual(["list"]);
    expect(result.coverage).toBeGreaterThanOrEqual(0.98);
    await expect(
      createCaptureTool(env.services).run(ctx, {
        scope: "element",
        selector: "#missing",
        kind: null,
      }),
    ).rejects.toMatchObject({ name: "ToolError", code: "selector_not_found" });
  });

  it("transcribes opaque canvas pages with the vision model as needs_review", async () => {
    const { result, blocks } = await capture("opaque/index.html");
    expect(result.fidelity).toBe("needs_review");
    expect(blocks.some((b) => b.type === "image" && b.origin === "dom" && b.assetId !== null)).toBe(
      true,
    );
    expect(
      blocks.some(
        (b) => b.origin === "ocr_model" && !b.verified && b.markdown.includes("Quarterly results"),
      ),
    ).toBe(true);
    expect(env.ocrCalls.length).toBeGreaterThan(0);
  });

  it("counts text outside the content root (Q1, W4)", async () => {
    const { result, blocks, source } = await capture("outside/index.html");
    // The reference is the whole page minus chrome, whatever root Defuddle picked.
    const extract = await (
      await captureWorlds(env.session)
    ).call(pageExtract, [{ scope: "page", selector: null }]);
    expect(extract.pageText).toContain("Comment sentinel");
    expect(extract.pageText).not.toContain("Footer text");
    expect(result.coverage).toBe((source.meta as { pageCoverage: number }).pageCoverage);
    // Either the comments made it into the note, or the note does not claim to be verified.
    const kept = blocks.some((b) => b.markdown.includes("Comment sentinel"));
    expect(kept || result.fidelity !== "verified").toBe(true);
  });

  it("stores no secret: MHTML skipped and no artefact holds the canary (W8)", async () => {
    // B3 seam: a run whose vault holds the canary.
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const { source, blocks } = await capture("secret/field.html", page, vault);
    expect(source.mhtmlKey).toBeNull();
    expect(blocks.every((b) => !b.markdown.includes("hunter2-canary"))).toBe(true);
    const canary = new TextEncoder().encode("hunter2-canary");
    for (const bytes of env.storage.objects.values())
      expect(Buffer.from(bytes).includes(Buffer.from(canary))).toBe(false);
  });

  it("refuses a page that shows a secret and leaves no rows or objects behind (D8)", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/secret/echo.html`, signal);
    const before = new Set(env.storage.objects.keys());
    const ctx = env.context(scope, vault);
    await expect(createCaptureTool(env.services).run(ctx, page)).rejects.toMatchObject({
      code: "secret_on_page",
    });
    await env.discard(ctx);
    const [run] = await env.db.db
      .select({ noteId: runs.noteId })
      .from(runs)
      .where(eq(runs.id, scope.runId));
    expect(run?.noteId).toBeNull();
    // The page also carries an inline SVG and an image: nothing at all was written (5-8 review I1).
    expect([...env.storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
    const stored = await env.db.db.execute(
      sql`select count(*)::int as n from assets where workspace_id = ${scope.workspaceId}`,
    );
    expect(stored[0]?.n).toBe(0);
  });

  it("captures a short text page from the DOM, without OCR (opaque ruling)", async () => {
    const calls = env.ocrCalls.length;
    const { result, blocks } = await capture("short/index.html");
    expect(blocks.map((b) => [b.origin, b.markdown])).toEqual([
      ["dom", "Mitochondria make most of the cell's ATP."],
    ]);
    expect(result.fidelity).toBe("verified");
    expect(env.ocrCalls.length).toBe(calls);
  });

  it("captures every same-process frame, srcdoc included, matched by frame id (5-8 review I4)", async () => {
    const { result, blocks, source } = await capture("frames/index.html");
    expect(source.meta).toMatchObject({ framesMissing: 0, mediaLost: 0 });
    expect(blocks.some((b) => b.markdown.includes("Count the carbon atoms"))).toBe(true);
    expect(blocks.some((b) => b.markdown.includes("Srcdoc sentinel"))).toBe(true);
    expect(result.fidelity).toBe("verified");
  });

  it("splits OCR text into blocks and survives an OCR outage as a lost tile (M4, M6)", async () => {
    const { blocks } = await capture("opaque/index.html");
    const ocr = blocks.filter((b) => b.origin === "ocr_model");
    expect(ocr.map((b) => b.markdown)).toEqual([
      "Quarterly results",
      "Revenue rose 12 percent on strong demand.",
    ]);
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
    const failing = createCaptureTool({
      ...env.services,
      ocr: {
        transcribe: async () => {
          throw new Error("upstream 503");
        },
      },
    });
    const result = await failing.run(env.context(scope), page);
    expect(result.fidelity).not.toBe("verified");
  });
});
