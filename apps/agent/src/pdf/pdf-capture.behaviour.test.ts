import { sources } from "@mastertutor/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCaptureTool } from "../capture/capture-tool.ts";
import { FIXTURES } from "../testing/browser-harness.ts";
import { type CaptureEnv, startCaptureEnv } from "../testing/capture-env.ts";
import { seedRun } from "../testing/notes.ts";

let env: CaptureEnv;
beforeAll(async () => {
  env = await startCaptureEnv();
}, 300_000);
afterAll(async () => {
  await env?.stop();
});

describe("capture tool on a PDF in the slot's viewer", () => {
  it("auto-detects the PDF, fetches it through the browser and stores a pdf source", async () => {
    const scope = await seedRun(env.db.db);
    await env.session.goto(`${FIXTURES}/pdf/paper.pdf`, new AbortController().signal);
    const ctx = env.context(scope);
    const result = await createCaptureTool(env.services).run(ctx, {
      scope: "page",
      selector: null,
      kind: null,
    });
    await env.commit(ctx);
    expect(result.coverage).toBeGreaterThanOrEqual(0.98);
    expect(result.fidelity).toBe("needs_review");
    const [source] = await env.db.db
      .select()
      .from(sources)
      .where(sql`${sources.meta}->>'noteId' = ${result.noteId}`);
    expect(source).toMatchObject({
      kind: "pdf",
      screenshotKey: expect.stringMatching(/page\.png$/),
      mhtmlKey: null,
    });
    expect(source?.meta).toMatchObject({
      engine: "pdfjs",
      pages: 3,
      pdfAssetId: expect.any(String),
    });
  }, 120_000);
});
