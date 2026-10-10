import { expect, it } from "vitest";
import { PersonDecider } from "@mastertutor/contracts";
import { capturePreferences, runs } from "@mastertutor/db";
import { eq } from "drizzle-orm";
import { createOpenAI } from "../llm/openai.ts";
import { createIntentModel } from "../capture/intent-model.ts";
import { initializeCaptureIntent } from "./capture-intent.ts";
import {
  setCaptureBrief,
  listCapturePreferences,
} from "../../../web/lib/server/runs/capture-intent.ts";
import { setRunApprovalMode, resumeRun } from "../../../web/lib/server/runs/service.ts";
import { done, drive, mock, owner, setup, status } from "./testing/loop-harness.ts";
const signal = () => new AbortController().signal;
const brief = {
  keep: ["reading_text", "figures"] as ("reading_text" | "figures")[],
  skip: ["due_dates", "scores"] as ("due_dates" | "scores")[],
  scopeNote: "Readings only",
};
const actor = PersonDecider.parse("user-1");
function hooks() {
  const model = createIntentModel(createOpenAI({ apiKey: "mock", baseURL: `${mock.url}/v1` }));
  return {
    prepareCapture: (
      context: Parameters<typeof initializeCaptureIntent>[2],
      step: Parameters<typeof initializeCaptureIntent>[3],
      s: AbortSignal,
    ) => initializeCaptureIntent(owner.db, model, context, step, s, (text) => text),
  };
}
it.each(["ask", "auto_within_allowlist", "bypass"] as const)(
  "asks once before observing, survives restore and mode changes (%s)",
  async (approvalMode) => {
    mock.setStructured("capture_intent", () => ({ brief, ambiguous: true }));
    const h = await setup([done()], { approvalMode, hooks: hooks() });
    await owner.db
      .delete(capturePreferences)
      .where(eq(capturePreferences.workspaceId, h.run.workspaceId));
    let observations = 0;
    h.browser.observeHook = () => {
      observations++;
    };
    expect(await h.loop.step(signal())).toEqual({ kind: "waiting", reason: "approval" });
    expect(observations).toBe(0);
    expect((await status(h.run.id))?.captureQuestion).not.toBeNull();
    const scope = { workspaceId: h.run.workspaceId, actor };
    await setRunApprovalMode(owner.db, scope, {
      runId: h.run.id,
      mode: "bypass",
      bypassAcknowledged: true,
    });
    await resumeRun(owner.db, scope, h.run.id);
    const restored = await h.reload();
    expect(await restored.resume(signal())).toEqual({ kind: "waiting", reason: "approval" });
    await setCaptureBrief(owner.db, scope, { runId: h.run.id, brief });
    expect((await status(h.run.id))?.status).toBe("running");
    expect(await restored.hasNews("approval")).toBe(true);
    expect(await restored.resume(signal())).toEqual({ kind: "continue" });
    expect(await drive(restored)).toEqual({ kind: "completed" });
    expect(JSON.stringify(mock.requestsFor(h.name).at(-1)?.body.input)).toContain("Capture brief");
    expect((await listCapturePreferences(owner.db, h.run.workspaceId)).items).toHaveLength(1);
    expect((await status(h.run.id))?.usage.inputTokens).toBeGreaterThan(0);
  },
);
it("reuses saved scope without asking and explicit goals override it", async () => {
  const h = await setup([done()], { hooks: hooks() });
  await owner.db
    .insert(capturePreferences)
    .values({ workspaceId: h.run.workspaceId, domain: "fixtures.test", brief })
    .onConflictDoUpdate({
      target: [capturePreferences.workspaceId, capturePreferences.domain],
      set: { brief },
    });
  mock.setStructured("capture_intent", () => ({ brief, ambiguous: true }));
  expect(await h.loop.step(signal())).toEqual({ kind: "continue" });
  expect((await status(h.run.id))?.captureQuestion).toBeNull();
  const next = await setup([done()], { hooks: hooks() });
  const explicit = {
    ...brief,
    keep: ["due_dates"] as "due_dates"[],
    skip: ["reading_text"] as "reading_text"[],
    scopeNote: "Due dates only",
  };
  mock.setStructured("capture_intent", () => ({ brief: explicit, ambiguous: false }));
  await next.loop.step(signal());
  expect((await status(next.run.id))?.captureBrief).toEqual(explicit);
  const foreign = await owner.db.select().from(runs).where(eq(runs.id, next.run.id));
  await expect(
    setCaptureBrief(
      owner.db,
      { workspaceId: "11111111-1111-4111-8111-111111111111", actor },
      { runId: foreign[0]!.id, brief },
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});
