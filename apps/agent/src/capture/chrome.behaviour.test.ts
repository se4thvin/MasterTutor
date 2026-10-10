import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { noteBlocks, notes, sources } from "@mastertutor/db";
import { FIXTURES } from "../testing/browser-harness.ts";
import { startCaptureEnv, type CaptureEnv } from "../testing/capture-env.ts";
import { seedRun } from "../testing/notes.ts";
import { positionOrder } from "../notes/positions.ts";
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
const page = { kind: null, scope: "page" as const, selector: null };

describe("generic platform chrome (F6)", () => {
  it("drops repeated banners in sibling interactive widgets and stores prose verbatim in order", async () => {
    await env.session.goto(`${FIXTURES}/capture/platform-chrome/widgets.html`, signal);
    const before = await env.session.page.content();
    const worlds = await captureWorlds(env.session);
    const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    const prose = [
      "A bit has two possible values: 0 and 1.",
      "Select the value represented by an enabled switch.",
      "Two bits represent four values, in order: 00, 01, 10, 11.",
      "A repeated theorem is still content.",
      "Enter the two-bit representation of three.",
      "A repeated theorem is still content.",
      "Each additional bit doubles the number of possible values.",
    ];
    for (const field of [extract.markdown, extract.sourceText, extract.pageText]) {
      expect(field).not.toContain("Due: 09/04/2026, 11:59 PM CDT");
      expect(field).not.toContain("This assignment's due date has passed.");
      let after = 0;
      for (const text of prose) {
        const at = field.indexOf(text, after);
        expect(at).toBeGreaterThanOrEqual(after);
        after = at + text.length;
      }
    }
    expect(await env.session.page.content()).toBe(before);
    const ctx = env.context(await seedRun(env.db.db));
    const result = await createCaptureTool(env.services).run(ctx, page);
    await env.commit(ctx);
    const stored = await env.db.db
      .select()
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, result.noteId!))
      .orderBy(positionOrder);
    expect(stored.map((block) => block.markdown).join("\n")).not.toContain("due date has passed");
    const text = stored.map((block) => block.markdown).join("\n");
    let after = 0;
    for (const passage of prose) {
      const at = text.indexOf(passage, after);
      expect(at).toBeGreaterThanOrEqual(after);
      after = at + passage.length;
    }
  });

  it("excludes semantic and repeated exterior chrome from blocks and coverage without editing prose", async () => {
    await env.session.goto(`${FIXTURES}/capture/platform-chrome/lesson.html`, signal);
    const before = await env.session.page.content();
    const worlds = await captureWorlds(env.session);
    const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
    for (const field of [extract.markdown, extract.sourceText, extract.pageText]) {
      for (const chrome of [
        "Due: 03/14/2031",
        "This assignment's due date has passed.",
        "Course dashboard",
        "Submission window closed.",
        "Progress: 100%",
        "Last saved just now.",
        "Session expires soon.",
      ])
        expect(field).not.toContain(chrome);
      expect(field).toContain("Even parity adds a bit so the total number of ones is even.");
      expect(field).toContain(
        "Due: is also an ordinary word in a lesson; this sentence stays verbatim.",
      );
      expect(field.split("A repeated theorem is still content.").length - 1).toBe(2);
    }
    expect(await env.session.page.content()).toBe(before);
    const ctx = env.context(await seedRun(env.db.db));
    const result = await createCaptureTool(env.services).run(ctx, page);
    expect(result.fidelity).toBe("verified");
    expect(result.coverage).toBeGreaterThanOrEqual(0.98);
    await env.commit(ctx);
    const stored = await env.db.db
      .select()
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, result.noteId!));
    for (const text of [
      "Even parity adds a bit so the total number of ones is even.",
      "Due: is also an ordinary word in a lesson; this sentence stays verbatim.",
    ])
      expect(stored.some((block) => block.markdown === text)).toBe(true);
    expect(
      stored.filter((block) => block.markdown === "A repeated theorem is still content."),
    ).toHaveLength(2);
  });

  it("refuses navigation-only capture before creating a note or source", async () => {
    const run = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/platform-chrome/assignments.html`, signal);
    const ctx = env.context(run);
    await expect(createCaptureTool(env.services).run(ctx, page)).rejects.toMatchObject({
      code: "navigation_only",
    });
    await env.commit(ctx);
    expect(await env.db.db.select().from(notes).where(eq(notes.runId, run.runId))).toEqual([]);
    expect(
      await env.db.db.select().from(sources).where(eq(sources.workspaceId, run.workspaceId)),
    ).toEqual([]);
  });

  it("recognizes link directories with unannotated row badges", async () => {
    await env.session.page.setContent(
      '<main><h1>Index</h1><ul><li><a href="/first">First</a><span>P</span></li><li><a href="/second">Second</a><span>P</span></li></ul></main>',
    );
    const ctx = env.context(await seedRun(env.db.db));
    await expect(createCaptureTool(env.services).run(ctx, page)).rejects.toMatchObject({
      code: "navigation_only",
    });
  });

  it("refuses same-document overviews with headings and short per-link scores without storing rows", async () => {
    const run = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/capture/platform-chrome/overview.html`, signal);
    const ctx = env.context(run);
    await expect(createCaptureTool(env.services).run(ctx, page)).rejects.toMatchObject({
      code: "navigation_only",
    });
    await env.commit(ctx);
    expect(await env.db.db.select().from(notes).where(eq(notes.runId, run.runId))).toEqual([]);
    expect(
      await env.db.db.select().from(sources).where(eq(sources.workspaceId, run.workspaceId)),
    ).toEqual([]);
  });

  it("recognizes same-origin directories without list markup", async () => {
    await env.session.goto(`${FIXTURES}/capture/platform-chrome/overview.html`, signal);
    await env.session.page.setContent(
      '<main><h1>Contents</h1><h2>Chapters</h2><div><a href="/first">First chapter</a> 100%</div><div><a href="/second">Second chapter</a> 50%</div></main>',
    );
    const ctx = env.context(await seedRun(env.db.db));
    await expect(createCaptureTool(env.services).run(ctx, page)).rejects.toMatchObject({
      code: "navigation_only",
    });
  });

  it("keeps short lessons, instructional lists, article link lists and activity prompts", async () => {
    for (const html of [
      "<main><h1>Bit</h1><p>A bit is 0 or 1.</p></main>",
      '<main><h1>Procedure</h1><ol><li>Read the <a href="/word">word</a>.</li><li>Count ones.</li></ol></main>',
      '<main><h1>Procedure</h1><ol><li>Read the <a href="/word">word</a>.</li><li>Count the <a href="/bits">bits</a>.</li></ol></main>',
      '<main><h1>Lesson</h1><p>A bit is 0 or 1.</p><ul><li><a href="/first">First chapter</a> 100%</li><li><a href="/second">Second chapter</a> 50%</li></ul></main>',
      '<main><h1>Further reading</h1><ul><li><a href="https://one.example/paper">First paper</a> 2026</li><li><a href="https://two.example/paper">Second paper</a> 2025</li></ul></main>',
      '<main><h1>References</h1><ul><li><a href="/first">First paper</a><p>This paper explains how the representation of a bit changes between different physical devices, with examples and experimental results.</p></li><li><a href="/second">Second paper</a> 2025</li></ul></main>',
      '<article><h1>References</h1><ul><li><a href="/paper">Original paper</a></li></ul></article>',
      '<main><h1>Exercise</h1><form><label>Choose the even parity bit.</label><input type="radio"><label>0</label><input type="radio"><label>1</label></form></main>',
    ]) {
      await env.session.page.setContent(html);
      const worlds = await captureWorlds(env.session);
      const extract = await worlds.call(pageExtract, [{ scope: "page", selector: null }]);
      expect(extract.sourceText).toBeTruthy();
      expect(extract.markdown).toBeTruthy();
    }
  });
});

it("D57 keeps run-5 prose verbatim, skips due banners and the scored overview; F10 uses main heading", async () => {
  const { runs } = await import("@mastertutor/db");
  const { createSelectionModel } = await import("./selection.ts");
  const { createOpenAI } = await import("../llm/openai.ts");
  const { startLlmMock } = await import("../../../../tests/llm-mock/src/server.ts");
  const mock = await startLlmMock();
  const previous = env.services.selection;
  try {
    mock.setStructured("capture_selection", (body) => {
      const raw = JSON.stringify(body.input);
      if (raw.includes("148/148")) return { ids: [] };
      const input = body.input as Array<{ content: string }>;
      const data = JSON.parse(
        input[0]!.content.replace(/^[\s\S]*?\n/, "").replace(/\n<\/untrusted_page_content>$/, ""),
      ) as { blocks: Array<{ id: string; preview: string }> };
      return {
        ids: data.blocks
          .filter((b) => !b.preview.includes("Due:") && !b.preview.includes("due date has passed"))
          .map((b) => b.id)
          .reverse(),
      };
    });
    env.services.selection = createSelectionModel(
      createOpenAI({ apiKey: "mock", baseURL: `${mock.url}/v1` }),
    );
    const scope = await seedRun(env.db.db);
    await env.db.db
      .update(runs)
      .set({
        captureBrief: {
          keep: ["reading_text", "activities"],
          skip: ["due_dates", "scores", "navigation"],
          scopeNote: "Readings only",
        },
      })
      .where(eq(runs.id, scope.runId));
    await env.session.goto(`${FIXTURES}/capture/intent-capture.html`, signal);
    const ctx = env.context(scope);
    const result = await createCaptureTool(env.services).run(ctx, page);
    await env.commit(ctx);
    const stored = await env.db.db
      .select()
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, result.noteId!));
    const text = stored
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      .map((b) => b.markdown)
      .join("\n");
    const prose = [
      "A bit has two possible values: 0 and 1.",
      "Two bits represent four values, in order: 00, 01, 10, 11.",
      "Each additional bit doubles the number of possible values.",
    ];
    expect(stored.map((b) => b.markdown)).toEqual(expect.arrayContaining(prose));
    expect(text.indexOf(prose[0]!)).toBeLessThan(text.indexOf(prose[1]!));
    expect(text).not.toContain("Due:");
    expect(text).not.toContain("due date has passed");
    expect(
      (await env.db.db.select().from(notes).where(eq(notes.id, result.noteId!)))[0]?.title,
    ).toBe("1.4 Binary values");
    await env.session.goto(`${FIXTURES}/capture/intent-capture.html?overview`, signal);
    const empty = await createCaptureTool(env.services).run(env.context(scope), page);
    expect(empty.noteId).toBeNull();
    expect(empty.blockIds).toEqual([]);
    expect(await env.db.db.select().from(notes).where(eq(notes.runId, scope.runId))).toHaveLength(
      1,
    );
    expect(mock.requests.every((r) => r.body.store === false)).toBe(true);
  } finally {
    env.services.selection = previous;
    await mock.close();
  }
});

it("F10 prefers a visible main heading over a stale SPA title", async () => {
  await env.session.goto(`${FIXTURES}/capture/intent-capture.html`, signal);
  const worlds = await captureWorlds(env.session);
  expect((await worlds.call(pageExtract, [{ scope: "page", selector: null }])).title).toBe(
    "1.4 Binary values",
  );
});
