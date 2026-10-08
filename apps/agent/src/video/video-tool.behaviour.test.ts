import { noteBlocks, notes, runs, sources } from "@mastertutor/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MaskSources } from "../browser/masking.ts";
import { FIXTURES } from "../testing/browser-harness.ts";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { seedRun } from "../testing/notes.ts";
import { isTimedtextUrl } from "./captions.ts";
import { createVideoTool } from "./video-tool.ts";

let env: CaptureEnv;
const signal = new AbortController().signal;
beforeAll(async () => {
  env = await startCaptureEnv({ responseLog: isTimedtextUrl });
}, 300_000);
afterAll(async () => {
  await env?.stop();
});

type Args = Parameters<ReturnType<typeof createVideoTool>["run"]>[1];
async function open(path: string) {
  const scope = await seedRun(env.db.db);
  await env.session.goto(`${FIXTURES}/youtube/${path}`, signal);
  return scope;
}
async function op(
  scope: { runId: string; workspaceId: string },
  args: Args,
  tool = createVideoTool(env.services),
  mask?: MaskSources,
) {
  const ctx = env.context(scope, mask);
  try {
    const result = await tool.run(ctx, args);
    await env.commit(ctx);
    return result;
  } catch (error) {
    await env.discard(ctx);
    throw error;
  }
}
async function fidelityOf(runId: string) {
  const [note] = await env.db.db
    .select({ fidelity: notes.fidelity })
    .from(notes)
    .where(eq(notes.id, await noteOf(runId)));
  return note?.fidelity;
}
async function noteOf(runId: string) {
  const [run] = await env.db.db
    .select({ noteId: runs.noteId })
    .from(runs)
    .where(eq(runs.id, runId));
  return run!.noteId!;
}

describe("video tool (B4 done-when: the YouTube fixture produces a chaptered note)", () => {
  it("lays out chapters with interleaved transcript and keyframes", async () => {
    const scope = await open("watch.html");
    expect(createVideoTool(env.services).untrusted).toBe(true);
    expect(await op(scope, { op: "chapters", range: null })).toEqual({
      op: "chapters",
      chapters: [
        { title: "Intro", start: 0 },
        { title: "Light reactions", start: 5 },
        { title: "Calvin cycle", start: 10 },
        { title: "Summary", start: 15 },
      ],
    });
    expect(await op(scope, { op: "captions", range: null })).toMatchObject({
      op: "captions",
      segments: 8,
      language: "en",
    });
    expect(await op(scope, { op: "keyframes", range: null })).toMatchObject({
      op: "keyframes",
      kept: 4,
      drm: false,
    });
    expect(await op(scope, { op: "chapters", range: null })).toMatchObject({ op: "chapters" });
    const noteId = await noteOf(scope.runId);
    const rows = await env.db.db
      .select({
        type: noteBlocks.type,
        markdown: noteBlocks.markdown,
        anchor: noteBlocks.anchor,
        assetId: noteBlocks.assetId,
      })
      .from(noteBlocks)
      .where(eq(noteBlocks.noteId, noteId))
      .orderBy(sql`${noteBlocks.position} collate "C"`);
    const sections: string[][] = [];
    for (const row of rows) {
      if (row.type === "heading") sections.push([row.markdown]);
      else sections.at(-1)!.push(row.type);
    }
    expect(sections.map((s) => s[0])).toEqual([
      "## Intro",
      "## Light reactions",
      "## Calvin cycle",
      "## Summary",
    ]);
    for (const section of sections) {
      expect(section).toContain("transcript");
      expect(section).toContain("keyframe");
    }
    const starts = rows.map((r) => r.anchor!.tStart!);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(rows.find((r) => r.type === "transcript")?.markdown).toBe(
      "Welcome to a short tour of photosynthesis. Plants turn light into chemical energy.",
    );
    expect(rows.filter((r) => r.type === "keyframe").every((r) => r.assetId !== null)).toBe(true);
    const [note] = await env.db.db
      .select({ fidelity: notes.fidelity })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.fidelity).toBe("verified");
  }, 180_000);

  it("stores auto-generated captions as ASR that needs review (Q4)", async () => {
    const scope = await open("watch-asr.html");
    await op(scope, { op: "captions", range: null });
    const noteId = await noteOf(scope.runId);
    const blocks = await env.db.db.select().from(noteBlocks).where(eq(noteBlocks.noteId, noteId));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.origin === "asr" && !b.verified)).toBe(true);
    const [note] = await env.db.db
      .select({ fidelity: notes.fidelity })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.fidelity).toBe("needs_review");
  }, 60_000);

  it("refuses transcribe whenever captions exist, even before a captions op (D4)", async () => {
    let transcribed = 0;
    const tool = createVideoTool({
      ...env.services,
      transcriber: { transcribe: async () => ((transcribed += 1), []) },
    });
    const scope = await open("watch.html");
    await expect(op(scope, { op: "transcribe", range: null }, tool)).rejects.toMatchObject({
      code: "captions_available",
    });
    expect(transcribed).toBe(0);
  }, 60_000);

  it("caps one call at 600 s; DRM and unplayable video are flagged and never verified (S9, W9, I2)", async () => {
    const scope = await open("watch.html");
    await expect(
      op(scope, { op: "keyframes", range: { start: 0, end: 700 } }),
    ).rejects.toMatchObject({ code: "range_too_long" });
    const drm = await open("drm.html");
    expect(await op(drm, { op: "keyframes", range: null })).toMatchObject({ drm: true, kept: 0 });
    expect(await fidelityOf(drm.runId)).toBe("partial");
    const broken = await open("broken.html");
    expect(await op(broken, { op: "keyframes", range: { start: 0, end: 10 } })).toMatchObject({
      drm: true,
      kept: 0,
    });
    const [source] = await env.db.db
      .select({ meta: sources.meta })
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${await noteOf(broken.runId)}`);
    expect(source?.meta).toMatchObject({ drm: true, playback: "failed" });
    expect(await fidelityOf(broken.runId)).toBe("partial");
  }, 180_000);

  it("counts a slide it could not capture, so the note is not verified (I1)", async () => {
    const scope = await open("watch-collapse.html");
    const result = await op(scope, { op: "keyframes", range: null });
    expect(result).toMatchObject({ op: "keyframes", drm: false });
    expect((result as { kept: number }).kept).toBeGreaterThan(2);
    expect(await fidelityOf(scope.runId)).toBe("partial");
  }, 120_000);

  it("uses the content's length, not an ad's, and refuses frames while the ad plays (I8)", async () => {
    const scope = await open("watch-ad.html");
    expect(await op(scope, { op: "captions", range: null })).toMatchObject({ segments: 8 });
    await expect(op(scope, { op: "keyframes", range: null })).rejects.toMatchObject({
      code: "ad_playing",
    });
    const broken = await open("broken.html");
    await expect(op(broken, { op: "keyframes", range: null })).rejects.toMatchObject({
      code: "duration_unknown",
    });
  }, 120_000);

  it("never stores a keyframe whose pixels show a secret on a secret-holding run", async () => {
    const vault: MaskSources = {
      nodeIds: () => [],
      hasSecrets: () => true,
      redact: (text: string) => text.replaceAll("hunter2-canary", "[secret]"),
    };
    const scope = await open("watch.html");
    const before = new Set(env.storage.objects.keys());
    const tool = createVideoTool({
      ...env.services,
      localOcr: { text: async () => "Password: hunter2-canary", words: async () => [] },
    });
    expect(await op(scope, { op: "keyframes", range: null }, tool, vault)).toMatchObject({
      kept: 0,
      drm: false,
    });
    expect([...env.storage.objects.keys()].filter((key) => !before.has(key))).toEqual([]);
    const noteId = await noteOf(scope.runId);
    const [note] = await env.db.db
      .select({ fidelity: notes.fidelity })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(note?.fidelity).toBe("partial");
  }, 120_000);

  it("uses description chapters and returns zero captions when the player has none", async () => {
    const scope = await open("watch-nocc.html");
    expect(await op(scope, { op: "chapters", range: null })).toMatchObject({
      op: "chapters",
      chapters: [
        { title: "Intro", start: 0 },
        { title: "Light reactions", start: 5 },
        { title: "Calvin cycle", start: 10 },
        { title: "Summary", start: 15 },
      ],
    });
    expect(await op(scope, { op: "captions", range: null })).toEqual({
      op: "captions",
      blockIds: [],
      segments: 0,
      language: null,
    });
  });
});
