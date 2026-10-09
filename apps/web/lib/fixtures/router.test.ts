import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { liveRouter } from "../server/rpc/live-router.ts";
import { FIXTURE_VIEWER } from "../server/viewer.ts";
import { fixtureNamespaceFrom } from "./cookies.ts";
import { ids } from "./ids.ts";
import { fixtureRouter } from "./router.ts";
import { RECORDED_RUN_ID, recordedEvents, recordedSteps } from "./run-recording.ts";
import { stateFor } from "./store.ts";

let counter = 0;
function client() {
  counter += 1;
  const ns = `test-${counter}`;
  return {
    ns,
    api: createRouterClient(fixtureRouter, { context: { ns, viewer: FIXTURE_VIEWER } }),
  };
}

describe("session", () => {
  it("rejects every call without a viewer as UNAUTHORIZED, in both routers", async () => {
    const fixture = createRouterClient(fixtureRouter, { context: { ns: "x", viewer: null } });
    await expect(fixture.settings.get({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(fixture.vault.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const live = createRouterClient(liveRouter, { context: { viewer: null } });
    await expect(live.settings.get({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("fixture notes", () => {
  it("lists by folder, unfiled and kind, newest first, with pagination", async () => {
    const { api } = client();
    const all = await api.notes.list({ limit: 4 });
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBe("4");
    const unfiled = await api.notes.list({ folder: "unfiled" });
    expect(unfiled.items.every((n) => n.folderId === null)).toBe(true);
    const pdfs = await api.notes.list({ kind: "pdf" });
    expect(pdfs.items.map((n) => n.sourceKinds)).toEqual([["pdf"]]);
    const opt = await api.notes.list({ folder: ids.folder(2) });
    expect(opt.items.map((n) => n.title)).toContain("Learning-rate warmup, explained");
  });

  it("returns a rich note with ordered blocks of every captured type", async () => {
    const { api } = client();
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const types = new Set(detail.blocks.map((b) => b.type));
    for (const type of [
      "heading",
      "paragraph",
      "list",
      "quote",
      "code",
      "table",
      "math",
      "image",
      "figure",
    ]) {
      expect(types.has(type as never), type).toBe(true);
    }
    const positions = detail.blocks.map((b) => b.position);
    expect([...positions].sort()).toEqual(positions);
  });

  it('orders blocks by position bytes (Postgres "C"), not by locale', async () => {
    const { ns, api } = client();
    const record = stateFor(ns).notes.find((r) => r.note.id === ids.note(1));
    if (!record) throw new Error("missing fixture note");
    const keys = ["aa", "aA", "a0", "Zz"];
    record.blocks = record.blocks
      .slice(0, keys.length)
      .map((b, i) => ({ ...b, position: keys[i] ?? "" }));
    const detail = await api.notes.get({ noteId: ids.note(1) });
    expect(detail.blocks.map((b) => b.position)).toEqual(["Zz", "a0", "aA", "aa"]);
  });

  it("searches block text and returns a snippet", async () => {
    const { api } = client();
    const { items } = await api.notes.search({ q: "grad_norm" });
    expect(items[0]).toMatchObject({ noteId: ids.note(1) });
    expect(items[0]?.snippet).toContain("grad_norm");
  });

  it("returns at most one hit per note, like the live hybrid search", async () => {
    const { api } = client();
    const { items } = await api.notes.search({ q: "warmup" });
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((i) => i.noteId)).size).toBe(items.length);
  });

  it("keeps the original on edit and flips fidelity when the last review clears", async () => {
    const { api } = client();
    const detail = await api.notes.get({ noteId: ids.note(1) });
    const para = detail.blocks.find((b) => b.type === "paragraph" && !b.edited);
    const edited = await api.notes.updateBlock({ blockId: para!.id, markdown: "Changed." });
    expect(edited).toMatchObject({
      edited: true,
      markdown: "Changed.",
      originalMarkdown: para!.markdown,
    });
    const review = detail.blocks.find((b) => !b.verified)!;
    expect(await api.notes.markVerified({ blockId: review.id })).toMatchObject({
      block: { verified: true },
      fidelity: "verified",
    });
    expect((await api.notes.get({ noteId: ids.note(1) })).note.fidelity).toBe("verified");
    // Lost media keeps a fully verified note partial (the one rule, final review I1).
    const lecture = await api.notes.get({ noteId: ids.note(9) });
    const transcript = lecture.blocks.find((b) => !b.verified)!;
    expect((await api.notes.markVerified({ blockId: transcript.id })).fidelity).toBe("partial");
    expect((await api.notes.get({ noteId: ids.note(9) })).note.fidelity).toBe("partial");
  });

  it("moves notes and records the user as filer", async () => {
    const { api } = client();
    await api.notes.move({ noteId: ids.note(1), folderId: null });
    const { note } = await api.notes.get({ noteId: ids.note(1) });
    expect(note).toMatchObject({ folderId: null, filedBy: "user" });
    await expect(
      api.notes.move({ noteId: ids.note(1), folderId: ids.folder(999) }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("fixture folders", () => {
  it("rejects cycles, depth and duplicate names", async () => {
    const { api } = client();
    await expect(
      api.folders.move({ folderId: ids.folder(1), parentId: ids.folder(3) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      api.folders.create({ name: "optimization", parentId: ids.folder(1) }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("deletes a subtree and unfiles its notes", async () => {
    const { api } = client();
    await api.folders.delete({ folderId: ids.folder(1) });
    const { folders } = await api.folders.tree({});
    expect(folders.map((x) => x.id)).not.toContain(ids.folder(3));
    expect((await api.notes.get({ noteId: ids.note(1) })).note.folderId).toBeNull();
  });
});

describe("fixture vault (Review Focus 2)", () => {
  it("keeps field names only, never values, and audits the create", async () => {
    const { api, ns } = client();
    const canary = "canary-secret-7f3a9c";
    const item = await api.vault.create({
      alias: "canary",
      origin: "learn.example.edu",
      label: "Canary",
      secrets: { username: "someone@example.test", password: canary },
    });
    expect(item).toMatchObject({
      origin: "https://learn.example.edu",
      fields: ["username", "password"],
    });
    expect(JSON.stringify(stateFor(ns))).not.toContain(canary);
    expect(JSON.stringify(item)).not.toContain(canary);
    const audit = await api.vault.audit({ limit: 1 });
    expect(audit.items[0]).toMatchObject({ alias: "canary", action: "create" });
  });

  it("rejects duplicate aliases", async () => {
    const { api } = client();
    await expect(
      api.vault.create({ alias: "github", origin: "https://github.com", label: "x", secrets: {} }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("forgets a saved session", async () => {
    const { api } = client();
    await api.vault.forgetSession({ alias: "github", origin: "https://github.com" });
    const { items } = await api.vault.list({});
    expect(items.find((i) => i.alias === "github")?.sessionSaved).toBe(false);
  });
  it("forgets idempotently: a session that is not saved is still ok (E6)", async () => {
    const { api } = client();
    await api.vault.forgetSession({ alias: "github", origin: "https://github.com" });
    await expect(
      api.vault.forgetSession({ alias: "github", origin: "https://github.com" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      api.vault.forgetSession({ alias: "nothing", origin: "https://nothing.example" }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("fixture settings and isolation", () => {
  it("toggles the kill switch per namespace only", async () => {
    const a = client();
    const b = client();
    expect((await a.api.settings.setKillSwitch({ on: true })).killSwitch).toBe(true);
    expect((await b.api.settings.get({})).killSwitch).toBe(false);
  });

  it("reports usage for every day in range", async () => {
    const { api } = client();
    const report = await api.settings.usage({ from: "2026-09-01", to: "2026-09-30" });
    expect(report.perDay).toHaveLength(30);
    expect(report.perDay[0]?.day).toBe("2026-09-01");
  });

  it("reads the namespace from the cookie header", () => {
    expect(fixtureNamespaceFrom("a=1; mt_fixture_ns=abc-123")).toBe("abc-123");
    expect(fixtureNamespaceFrom("mt_fixture_ns=../../x")).toBe("default");
    expect(fixtureNamespaceFrom(null)).toBe("default");
  });
});

describe("fixture runs (F3)", () => {
  it("serves the recorded run's detail and steps", async () => {
    const { api } = client();
    const detail = await api.runs.get({ runId: RECORDED_RUN_ID });
    expect(detail).toMatchObject({ status: "running", slotName: "browser-1", lastEventId: "12" });
    const { items } = await api.runs.steps({ runId: RECORDED_RUN_ID });
    expect(items.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await api.runs.steps({ runId: RECORDED_RUN_ID, afterSeq: 9 })).items).toEqual([]);
    const running = await api.runs.list({ status: "running", limit: 20 });
    expect(running.items.map((r) => r.id)).toEqual([RECORDED_RUN_ID]);
  });

  it("creates a queued run that get and list then serve", async () => {
    const { api } = client();
    const created = await api.runs.create({
      goal: "Capture example.com",
      allowedOrigins: ["https://example.com"],
    });
    expect(created).toMatchObject({ status: "queued", approvalMode: "ask", controller: "agent" });
    // The run keeps its scope: get reports the origins and target folder it was created with.
    expect(await api.runs.get({ runId: created.id })).toMatchObject({
      goal: "Capture example.com",
      allowedOrigins: ["https://example.com"],
      targetFolderId: null,
    });
    expect((await api.runs.list({ status: null, limit: 20 })).items[0]?.id).toBe(created.id);
  });

  it("records real step screenshot keys and one unpointered computer step (A8, W1)", () => {
    const keys = recordedSteps().flatMap((s) => (s.screenshotKey ? [s.screenshotKey] : []));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^runs\/[0-9a-f-]{36}\/steps\/\d+-[a-z0-9]+\.png$/);
    // The agent screenshots what it observes; act steps carry none (group 1 review, Minor 4).
    const shotPhases = [
      ...recordedSteps(),
      ...recordedEvents().flatMap((r) => (r.event.type === "step" ? [r.event] : [])),
    ].flatMap((s) => (s.screenshotKey ? [s.phase] : []));
    expect(new Set(shotPhases)).toEqual(new Set(["observe"]));
    const computer = recordedSteps().filter((s) => s.action?.tool === "computer");
    expect(computer.some((s) => s.action?.pointer === undefined)).toBe(true);
    expect(recordedEvents().map((r) => r.id)).toEqual([
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
    ]);
  });
});

describe("fixture alerts", () => {
  it("lists the seeded (acknowledged) alert and reports push unavailable on http", async () => {
    const { api } = client();
    expect((await api.alerts.active({})).items).toEqual([]);
    const listed = await api.alerts.list({ limit: 10, cursor: null });
    expect(listed.items.map((a) => a.label)).toEqual(["A run failed"]);
    expect(await api.alerts.pushConfig({})).toEqual({ available: false, publicKey: null });
    expect(await api.alerts.pushStatus({ endpoint: "https://web.push.apple.com/x" })).toEqual({
      registered: false,
    });
    await expect(
      api.alerts.subscribe({
        endpoint: "https://web.push.apple.com/abc",
        keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      api.alerts.acknowledge({ id: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
