import { assets, noteBlocks, notes, objectDeletions, runs, sources } from "@mastertutor/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { FIXTURES } from "../testing/browser-harness.ts";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { seedRun } from "../testing/notes.ts";
import { createLocalOcr } from "../browser/local-ocr.ts";
import { createSecretFingerprints } from "../vault/fingerprints.ts";
import { createCaptureTool } from "./capture-tool.ts";
import { mhtmlTexts } from "./mhtml-mask.ts";
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
    .where(eq(noteBlocks.noteId, result.noteId!))
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
      const [note] = await env.db.db.select().from(notes).where(eq(notes.id, result.noteId!));
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

  it("captures an interactive-textbook section; its left-out app UI keeps it from verified", async () => {
    const { result, blocks, source } = await capture("textbook/index.html");
    // The assignment box leaves the note but counts against coverage (audited in meta).
    expect(result.fidelity).toBe("partial");
    expect(result.coverage).toBeGreaterThan(0.85);
    expect(result.coverage).toBeLessThan(0.98);
    expect(source.meta).toMatchObject({ excludedTokens: expect.any(Number), mediaLost: 0 });
    expect((source.meta as { excludedTokens: number }).excludedTokens).toBeGreaterThanOrEqual(15);
    const callouts = blocks.filter((b) => b.type === "quote");
    expect(callouts).toHaveLength(3);
    for (const callout of callouts) {
      expect(callout.markdown).toMatch(
        /^> \[!example\] \[Interactive activity\]\(http\S+\/capture\/textbook\/index\.html#:~:text=2\.3\.\d/,
      );
      expect(callout.verified).toBe(true);
    }
    const [animation, shortAnswer, trueFalse] = callouts.map((c) => c.markdown);
    expect(animation).toMatch(/^> !\[\]\(asset:[0-9a-f-]{36}\)$/m);
    expect(animation).toContain("> Static figure: Step 1: Count the ones in 1011");
    expect(animation).toContain("> 2. Choose the parity bit that makes the count even.");
    for (const line of [
      "> 1\\) What is the even parity bit for 0110?",
      "> 2\\) What is the even parity bit for 1110?",
    ])
      expect(shortAnswer).toContain(line);
    for (const line of [
      "> Each received word uses even parity.",
      "> 1\\) 10010 shows an error.\n> \n> - True\n> - False",
      "> 2\\) Two flipped bits are always detected.\n> \n> - True\n> - False",
    ])
      expect(trueFalse).toContain(line);
    for (const text of ["Students:", "expand_more", "Due:", "ones:"])
      expect(blocks.filter((b) => b.markdown.includes(text))).toEqual([]);
    expect(blocks.filter((b) => b.type === "heading").map((b) => b.markdown)).toEqual([
      expect.stringMatching(/^#+ 2\.3 Parity bits$/),
      expect.stringMatching(/^#+ Even parity$/),
      expect.stringMatching(/^#+ Detecting errors$/),
    ]);
  });

  it("keeps a hero figure with a button above the H1: content, never UI (review I1)", async () => {
    const { result, blocks } = await capture("probes/hero.html");
    expect(result.fidelity).toBe("verified");
    expect(blocks.some((b) => b.type === "image" && b.assetId !== null)).toBe(true);
    expect(blocks.some((b) => b.markdown.includes("Gravel bars split the Waimakariri River"))).toBe(
      true,
    );
  });

  it("keeps every quiz prompt and option, label[for] pairs and math options included (review I2)", async () => {
    const { result, blocks } = await capture("probes/quiz.html");
    const [callout] = blocks.filter((b) => b.type === "quote");
    for (const text of [
      "Which law relates pressure and volume at constant temperature for a fixed amount of gas?",
      "> - Pressure doubles when volume halves\n> - Pressure halves when volume halves",
      "> - Answer $x=2$ exactly\n> - Answer $x=3$ exactly",
    ])
      expect(callout?.markdown).toContain(text);
    expect(callout?.verified).toBe(true);
    expect(result.fidelity).toBe("verified");
  });

  it("keeps every word of a body font whose name contains 'icon' (review I3)", async () => {
    const { result, blocks } = await capture("probes/font.html");
    expect(result.fidelity).toBe("verified");
    expect(blocks.map((b) => b.markdown)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^#+ Sediment$/),
        expect.stringContaining(
          "the *grain* size decides how far it travels before it [settles](#x)",
        ),
      ]),
    );
  });

  it("captures SPA sections 1.1–1.9 as distinct, verbatim notes in source order without duplicates", async () => {
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/spa-sections/index.html?section=1`, signal);
    const cdp = await env.session.cdp();
    const { frameTree: initial } = await cdp.send("Page.getFrameTree");
    const tool = createCaptureTool(env.services);
    const take = async (args: Args = page) => {
      const ctx = env.context(scope);
      const result = await tool.run(ctx, args);
      await env.commit(ctx);
      return result;
    };
    const captures = [];
    const repeated = "The same verbatim sentence appears at two distinct source locations.";
    for (let section = 1; section <= 9; section++) {
      if (section > 1) await env.session.page.locator(`[data-section="${section}"]`).click();
      expect(env.session.page.url()).toContain(`?section=${section}`);
      // A pushState navigation changes the source URL but keeps the browser document loaded.
      const { frameTree } = await cdp.send("Page.getFrameTree");
      expect(frameTree.frame.loaderId).toBe(initial.frame.loaderId);
      await take({ scope: "element", selector: "#figure", kind: null });
      await take({ scope: "element", selector: "#opening", kind: null });
      const partial = await env.db.db
        .select()
        .from(noteBlocks)
        .innerJoin(notes, eq(notes.id, noteBlocks.noteId))
        .where(eq(notes.runId, scope.runId))
        .orderBy(sql`${noteBlocks.position} collate "C"`);
      const full = await take();
      await env.session.page.locator("#reveal").click();
      const expanded = await take();
      const again = await take();
      await take({ scope: "element", selector: "#figure", kind: null });
      const blocks = await env.db.db
        .select()
        .from(noteBlocks)
        .where(eq(noteBlocks.noteId, expanded.noteId!))
        .orderBy(sql`${noteBlocks.position} collate "C"`);
      captures.push({ section, partial, full, expanded, again, blocks });
    }
    const storedNotes = await env.db.db.select().from(notes).where(eq(notes.runId, scope.runId));
    expect(storedNotes).toHaveLength(9);
    expect(new Set(captures.map((c) => c.full.noteId)).size).toBe(9);
    for (const { section, partial, full, expanded, again, blocks } of captures) {
      expect(storedNotes.find((n) => n.id === full.noteId)?.title).toBe(`Section 1.${section}`);
      // On the first section, reverse capture order must already be corrected before a page capture.
      if (section === 1)
        expect(partial.map((row) => row.note_blocks.markdown)).toEqual([
          `Section 1.${section} opens with the first source paragraph, which must precede its figure even when the figure is captured first.`,
          `## Figure 1.${section}.1`,
          `Figure 1.${section}.1 describes the source diagram in its own words, which the captured note must retain exactly as written.`,
        ]);
      expect(expanded.blockIds.slice(0, -1)).toEqual(full.blockIds);
      expect(again.blockIds).toEqual(expanded.blockIds);
      // Defuddle stores the repeated H1 as the note title; body content remains verbatim.
      expect(blocks.map((b) => b.markdown)).toEqual([
        `Section 1.${section} opens with the first source paragraph, which must precede its figure even when the figure is captured first.`,
        repeated,
        `## Figure 1.${section}.1`,
        `Figure 1.${section}.1 describes the source diagram in its own words, which the captured note must retain exactly as written.`,
        repeated,
        `Section 1.${section} reveals this additional source paragraph after its first page capture.`,
      ]);
      expect(
        new Set(blocks.map((b) => `${b.contentSha256}:${JSON.stringify(b.anchor)}`)).size,
      ).toBe(blocks.length);
      expect(blocks.filter((b) => b.markdown === repeated)).toHaveLength(2);
    }
    const storedSources = await env.db.db
      .select()
      .from(sources)
      .where(eq(sources.workspaceId, scope.workspaceId));
    expect(storedSources).toHaveLength(9);
    expect(new Set(storedSources.map((s) => s.url)).size).toBe(9);
    await env.session.page.locator('[data-section="1"]').click();
    await env.session.page.locator("#reveal").click();
    const revisit = await take();
    expect(revisit.noteId).toBe(captures[0]!.full.noteId);
    expect(revisit.blockIds).toEqual(captures[0]!.expanded.blockIds);
    expect(await env.db.db.select().from(notes).where(eq(notes.runId, scope.runId))).toHaveLength(
      9,
    );
  }, 180_000);

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

  it("stores no secret: a masked MHTML, and no artefact holds the canary, raw or decoded (W8, snapshot ruling)", async () => {
    // B3 seam: a run whose vault holds the canary.
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const { source, blocks } = await capture("secret/field.html", page, vault);
    expect(source.mhtmlKey).toMatch(/^snapshots\/.+\/page\.mhtml$/);
    expect(blocks.every((b) => !b.markdown.includes("hunter2-canary"))).toBe(true);
    const canary = new TextEncoder().encode("hunter2-canary");
    for (const bytes of env.storage.objects.values())
      expect(Buffer.from(bytes).includes(Buffer.from(canary))).toBe(false);
    const mhtml = new TextDecoder().decode(env.storage.objects.get(source.mhtmlKey!)!);
    expect(mhtmlTexts(mhtml).join("\n")).not.toContain("hunter2-canary");
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
  it("counts canvas past the OCR tile cap as lost, so the note is never verified (final I2)", async () => {
    const { result, source } = await capture("opaque/tall.html");
    // Five viewports of canvas, three read: two are not in the note.
    expect((source.meta as { mediaLost: number }).mediaLost).toBeGreaterThanOrEqual(2);
    expect(result.fidelity).not.toBe("verified");
  });
  it("counts an empty OCR read of a canvas region as lost, never verified (final I2)", async () => {
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
    const blank = createCaptureTool({ ...env.services, ocr: { transcribe: async () => "" } });
    const ctx = env.context(scope);
    const result = await blank.run(ctx, page);
    await env.commit(ctx);
    expect(result.fidelity).toBe("partial");
    const [source] = await env.db.db
      .select()
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    expect((source!.meta as { mediaLost: number }).mediaLost).toBeGreaterThanOrEqual(1);
  });
  it("reads frames without a placeholder and counts unread text as missing (re-review N2)", async () => {
    const { result, blocks, source } = await capture("frames/aside.html");
    expect(blocks.some((b) => b.markdown.includes("Small frame sentinel"))).toBe(false);
    // Both paths: the small frame (never a placeholder) and the sidebar frame (placeholder dropped).
    expect((source.meta as { framesMissing: number }).framesMissing).toBe(2);
    expect(result.fidelity).not.toBe("verified");
    // A frame whose text sits only in a frame nested inside it counts once (QA-078).
    const nested = await capture("frames/nested.html");
    expect(nested.blocks.some((b) => b.markdown.includes("Nested frame sentinel"))).toBe(false);
    expect((nested.source.meta as { framesMissing: number }).framesMissing).toBe(1);
    expect(nested.result.fidelity).not.toBe("verified");
  });

  it("OCRs and screens opaque tiles before storing them (re-review I1)", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
    const { cssVisualViewport: viewport } = await (
      await env.session.cdp()
    ).send("Page.getLayoutMetrics");
    // Only the viewport-sized page-region tiles: local OCR (a fake that reads nothing) passes the
    // canvas, and OpenAI's transcription of a tile is what shows the secret here.
    const tiles: string[] = [];
    const stored: string[] = [];
    const leaking = createCaptureTool({
      ...env.services,
      assets: {
        put: async (workspaceId, input, secrets) => {
          if (input.width === viewport.clientWidth && input.height === viewport.clientHeight)
            tiles.push(input.mime);
          const asset = await env.services.assets.put(workspaceId, input, secrets);
          stored.push(asset.assetId);
          return asset;
        },
      },
      ocr: { transcribe: async () => "Password: hunter2-canary" },
    });
    const ctx = env.context(scope, vault);
    await expect(leaking.run(ctx, page)).rejects.toMatchObject({ code: "secret_on_page" });
    await env.discard(ctx);
    expect(tiles).toEqual([]);
    // The canvas the local screen passed was stored first; the refusal deletes it (QA-094).
    expect(stored.length).toBeGreaterThan(0);
    const left = await env.db.db
      .select({ key: assets.key })
      .from(assets)
      .where(inArray(assets.id, stored));
    expect(left).toEqual([]);
    const queued = await env.db.db
      .select({ key: objectDeletions.key })
      .from(objectDeletions)
      .where(like(objectDeletions.key, `assets/${scope.workspaceId}/%`));
    expect(queued.length).toBeGreaterThan(0);
  });
  it("withholds an opaque tile OpenAI could not read on a secret run, keeps it otherwise (QA-079)", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text,
    };
    for (const [mask, kept] of [
      [vault, false],
      [undefined, true],
    ] as const) {
      const scope = await seedRun(env.db.db);
      await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
      const { cssVisualViewport: viewport } = await (
        await env.session.cdp()
      ).send("Page.getLayoutMetrics");
      const tiles: string[] = [];
      const tool = createCaptureTool({
        ...env.services,
        assets: {
          put: (workspaceId, input, secrets) => {
            if (input.width === viewport.clientWidth && input.height === viewport.clientHeight)
              tiles.push(input.mime);
            return env.services.assets.put(workspaceId, input, secrets);
          },
        },
        ocr: {
          transcribe: async () => {
            throw new Error("upstream 503");
          },
        },
      });
      const ctx = env.context(scope, mask);
      const result = await tool.run(ctx, page);
      await env.commit(ctx);
      expect(tiles.length > 0).toBe(kept);
      expect(result.fidelity).not.toBe("verified");
    }
  });
  it("counts only frames inside the capture scope and visible (A-I1)", async () => {
    // An element capture is not held back by an unrelated text frame elsewhere on the page.
    const target = await capture("frames/scoped.html", {
      scope: "element",
      selector: "#target",
      kind: null,
    });
    expect((target.source.meta as { framesMissing: number }).framesMissing).toBe(0);
    expect(target.result.fidelity).toBe("verified");
    // An in-scope frame whose text the note does not hold still blocks verified.
    const withFrame = await capture("frames/scoped.html", {
      scope: "element",
      selector: "#withframe",
      kind: null,
    });
    expect((withFrame.source.meta as { framesMissing: number }).framesMissing).toBe(1);
    expect(withFrame.result.fidelity).not.toBe("verified");
    // A frame the reader cannot see is ignored.
    const hidden = await capture("frames/hidden.html");
    expect((hidden.source.meta as { framesMissing: number }).framesMissing).toBe(0);
    expect(hidden.result.fidelity).toBe("verified");
  });
  it("never sends unscreened pixels to OpenAI on a secret-holding run (A-M1)", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const crashed = async (): Promise<never> => {
      throw new Error("tesseract crashed");
    };
    const box = { x: 10, y: 10, width: 200, height: 20 };
    for (const localOcr of [
      {
        text: async () => "Password: hunter2-canary",
        words: async () => [{ words: [{ text: "hunter2-canary", box }] }],
      },
      { text: crashed, words: crashed },
    ]) {
      const scope = await seedRun(env.db.db);
      await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
      const before = new Set(env.storage.objects.keys());
      let openAiPixels = 0;
      const tool = createCaptureTool({
        ...env.services,
        localOcr,
        ocr: { transcribe: async () => ((openAiPixels += 1), "Quarterly results") },
      });
      const ctx = env.context(scope, vault);
      const result = await tool.run(ctx, page);
      await env.commit(ctx);
      expect(openAiPixels).toBe(0);
      expect(result.fidelity).not.toBe("verified");
      const stored = [...env.storage.objects.keys()].filter((key) => !before.has(key));
      expect(stored.filter((key) => key.startsWith("assets/"))).toEqual([]);
      expect(stored.filter((key) => key.endsWith("page.png"))).toEqual([]);
    }
  });

  it("reads the page while page.png is screened, not after it (QA-092)", async () => {
    const vault: MaskSources = { nodeIds: () => [], hasSecrets: () => true, redact: (t) => t };
    let stored = false;
    const storedDuringScreen: boolean[] = [];
    const localOcr = {
      // The page's own read stores the article image; each screen waits for that (5 s at most).
      text: async () => {
        for (let waited = 0; !stored && waited < 5_000; waited += 50)
          await new Promise((resolve) => setTimeout(resolve, 50));
        storedDuringScreen.push(stored);
        return "";
      },
      words: async () => [],
    };
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const ctx = env.context(scope, vault);
    const tool = createCaptureTool({
      ...env.services,
      localOcr,
      assets: {
        put: async (workspaceId, input, secrets) => {
          stored = true;
          return env.services.assets.put(workspaceId, input, secrets);
        },
      },
    });
    const result = await tool.run(ctx, page);
    await env.commit(ctx);
    expect(storedDuringScreen[0]).toBe(true);
    const [source] = await env.db.db
      .select()
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    expect(source?.screenshotKey).toMatch(/page\.png$/);
  });

  it("screens an opaque tile with its neighbours' edge lines whole before OpenAI sees it (review I2)", async () => {
    // The vault's own matcher (exact and confusable-folded), as a run holding this secret has.
    const prints = createSecretFingerprints();
    prints.remember("review-i2", {
      filled: {
        cdp: await env.session.cdp(),
        frameId: "main",
        loaderId: "doc",
        backendNodeIds: [],
      },
      secret: "MARMOT4CANARY8VELVET",
    });
    const vault = prints.forRun("review-i2");
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/opaque/index.html`, signal);
    const { cssVisualViewport: viewport } = await (
      await env.session.cdp()
    ).send("Page.getLayoutMetrics");
    // A canvas-only page whose secret line straddles the first tile's bottom edge.
    const edge = viewport.clientHeight;
    await env.session.page.setContent(`<body style="margin:0">
      <canvas id="c" width="1000" height="${edge * 2}"></canvas><script>{
        const ctx = document.getElementById("c").getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1000, ${edge * 2});
        ctx.fillStyle = "#000"; ctx.font = "40px sans-serif";
        ctx.fillText("Quarterly report", 40, 120);
        ctx.fillText("Key MARMOT4CANARY8VELVET", 40, ${edge + 14});
      }</script></body>`);
    let openAiPixels = 0;
    const reader = createLocalOcr();
    try {
      const tool = createCaptureTool({
        ...env.services,
        localOcr: reader,
        ocr: { transcribe: async () => ((openAiPixels += 1), "Quarterly report") },
      });
      const ctx = env.context(scope, vault);
      await tool.run(ctx, page);
      await env.commit(ctx);
    } finally {
      await reader.close();
    }
    expect(openAiPixels).toBe(0);
  }, 180_000);

  it("withholds page.png when local OCR finds a secret or fails (A-M2)", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const crashed = async (): Promise<never> => {
      throw new Error("tesseract crashed");
    };
    for (const localOcr of [
      { text: async () => "hunter2-canary", words: async () => [] },
      { text: crashed, words: crashed },
    ]) {
      const scope = await seedRun(env.db.db);
      await env.session.goto(`${FIXTURES}/capture/article/index.html`, signal);
      const ctx = env.context(scope, vault);
      const result = await createCaptureTool({ ...env.services, localOcr }).run(ctx, page);
      await env.commit(ctx);
      const [source] = await env.db.db
        .select()
        .from(sources)
        .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
      expect(source?.screenshotKey).toBeNull();
      expect((source?.meta as { snapshot: { skipped: string[] } }).snapshot.skipped).toContain(
        "png:withheld",
      );
    }
    // Control: the same page and vault with a clean local read keeps page.png.
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/article/index.html`, signal);
    const ctx = env.context(scope, vault);
    const clean = { text: async () => "", words: async () => [] };
    const result = await createCaptureTool({ ...env.services, localOcr: clean }).run(ctx, page);
    await env.commit(ctx);
    const [source] = await env.db.db
      .select()
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    expect(source?.screenshotKey).toMatch(/page\.png$/);
  });
});
