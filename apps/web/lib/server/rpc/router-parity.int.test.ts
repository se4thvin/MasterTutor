import { apiContract, type ApiContract } from "@mastertutor/contracts";
import {
  approvals,
  createDb,
  ensureWorkspaceMember,
  folders,
  type DbHandle,
} from "@mastertutor/db";
import { seedRun, startTestDatabase, type TestDatabase } from "@mastertutor/db/testing";
import type { ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureRouter } from "../../fixtures/router.ts";
import { RECORDED_APPROVAL_ID } from "../../fixtures/run-recording.ts";
import { createSealer } from "../vault/sealer.ts";
import { FIXTURE_VIEWER, type Viewer } from "../viewer.ts";
import { createLiveRouter } from "./live-router.ts";

type Api = ContractRouterClient<ApiContract>;
interface World {
  session(): Api;
  anonymous(): Api;
  /** Procedures this router does not serve yet; their probes and cases are skipped on it. */
  deferred: ReadonlySet<string>;
  /** A folder to target: the API where it is wired, a direct insert until then. */
  folder(name: string): Promise<string>;
  /** A pending approval no one has decided yet. */
  pendingApproval(): Promise<string>;
}

const MISSING = "00000000-0000-4000-8000-00000000dead";
// The .env.test dummy public key (Phase 0), as vault.int.test.ts uses. It protects nothing.
const TEST_PUBLIC = "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=";

/** T18 wires benchmarks.* and deletes this exclusion. */
const UNTIL_T18 = "benchmarks";
/** Branch b6-a9-a12 (P2, B6 createLiveHandlers) wires these and deletes this exclusion. */
const UNTIL_P2_B6 = ["runs/takeControl", "runs/handBack", "runs/openLive"] as const;
/** Branch b245-t0 (P3, B2 library handlers; Task 0C binds them) wires these and deletes this exclusion. */
const UNTIL_P3_B2 = [
  "notes/list",
  "notes/get",
  "notes/updateBlock",
  "notes/markVerified",
  "notes/move",
  "notes/delete",
  "notes/export",
  "notes/search",
  "folders/tree",
  "folders/create",
  "folders/rename",
  "folders/move",
  "folders/delete",
  "assets/url",
] as const;
/** Live procedures still answering NOT_IMPLEMENTED outside benchmarks.*. Empty after P2 and P3. */
const LIVE_DEFERRED: ReadonlySet<string> = new Set([...UNTIL_P2_B6, ...UNTIL_P3_B2]);

/** One probe per procedure without a lasting side effect: unknown ids, or a harmless read. */
const PROBES: ReadonlyArray<readonly [string, unknown, "ok" | "not_found"]> = [
  ["runs/list", { limit: 1 }, "ok"],
  ["runs/get", { runId: MISSING }, "not_found"],
  ["runs/steps", { runId: MISSING }, "not_found"],
  ["runs/cancel", { runId: MISSING }, "not_found"],
  ["runs/resume", { runId: MISSING }, "not_found"],
  ["runs/sendMessage", { runId: MISSING, text: "probe" }, "not_found"],
  ["runs/decideApproval", { approvalId: MISSING, decision: "denied" }, "not_found"],
  ["runs/submitOtp", { runId: MISSING, code: "123456" }, "not_found"],
  ["runs/takeControl", { runId: MISSING }, "not_found"],
  ["runs/handBack", { runId: MISSING, note: null }, "not_found"],
  ["runs/openLive", { runId: MISSING }, "not_found"],
  ["notes/list", {}, "ok"],
  ["notes/get", { noteId: MISSING }, "not_found"],
  ["notes/updateBlock", { blockId: MISSING, markdown: "probe" }, "not_found"],
  ["notes/markVerified", { blockId: MISSING }, "not_found"],
  ["notes/move", { noteId: MISSING, folderId: null }, "not_found"],
  ["notes/delete", { noteId: MISSING }, "not_found"],
  ["notes/export", { noteId: MISSING }, "not_found"],
  ["notes/search", { q: "probe" }, "ok"],
  ["folders/tree", {}, "ok"],
  ["folders/rename", { folderId: MISSING, name: "probe" }, "not_found"],
  ["folders/move", { folderId: MISSING, parentId: null }, "not_found"],
  ["folders/delete", { folderId: MISSING }, "not_found"],
  ["vault/list", {}, "ok"],
  ["vault/setSecret", { itemId: MISSING, field: "password", value: "probe-value" }, "not_found"],
  ["vault/removeSecret", { itemId: MISSING, field: "password" }, "not_found"],
  ["vault/delete", { itemId: MISSING }, "not_found"],
  // Idempotent (E6, P7-13): forgetting nothing is ok.
  ["vault/forgetSession", { alias: "no-such-alias", origin: "https://probe.example" }, "ok"],
  ["vault/audit", { limit: 1 }, "ok"],
  ["settings/get", {}, "ok"],
  ["settings/usage", { from: "2026-10-01", to: "2026-10-05" }, "ok"],
  ["assets/url", { assetId: MISSING }, "not_found"],
];
/** Procedures that create or change state, with inputs each call may repeat. */
const CREATE_INPUTS: Record<string, () => unknown> = {
  "runs/create": () => ({ goal: "probe", allowedOrigins: ["https://example.com"] }),
  "folders/create": () => ({ name: `Probe ${crypto.randomUUID().slice(0, 8)}` }),
  "vault/create": () => ({
    alias: `probe-${crypto.randomUUID().slice(0, 8)}`,
    origin: "https://probe.example",
    label: "Probe",
    secrets: {},
  }),
  "settings/update": () => ({ version: "stale-version" }),
  "settings/setKillSwitch": () => ({ on: false }),
};
const EVERY_CALL: ReadonlyArray<readonly [string, () => unknown]> = [
  ...PROBES.map(([path, input]) => [path, () => input] as const),
  ...Object.entries(CREATE_INPUTS),
];

const call = (api: Api, path: string) => {
  const [group, name] = path.split("/") as [string, string];
  return (api as unknown as Record<string, Record<string, (input: unknown) => Promise<unknown>>>)[
    group
  ]![name]!;
};
/** "ok", or the oRPC error code a call ended with. */
async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

const viewer: Viewer = { id: "u-parity", name: "P", email: "parity@example.test" };
let tdb: TestDatabase;
let owner: DbHandle;
let web: DbHandle;
let workspaceId: string;
let liveRouter: ReturnType<typeof createLiveRouter>;
let fixtureNs = 0;
let fixtureSession: Api | undefined;

const worlds: ReadonlyArray<readonly [string, World]> = [
  [
    "fixtureRouter",
    {
      // A fresh namespace (seeded state) per session, as fe's fixture tests do.
      session: () =>
        (fixtureSession = createRouterClient(fixtureRouter, {
          context: { ns: `parity-${++fixtureNs}`, viewer: FIXTURE_VIEWER },
        })),
      anonymous: () =>
        createRouterClient(fixtureRouter, { context: { ns: "parity-anon", viewer: null } }),
      deferred: new Set(),
      folder: async (name) => (await fixtureSession!.folders.create({ name })).id,
      // Each session is a fresh namespace, so the recorded approval is still pending there.
      pendingApproval: async () => RECORDED_APPROVAL_ID,
    },
  ],
  [
    "liveRouter",
    {
      session: () => createRouterClient(liveRouter, { context: { viewer } }),
      anonymous: () => createRouterClient(liveRouter, { context: { viewer: null } }),
      deferred: LIVE_DEFERRED,
      // UNTIL_P3_B2: folders.create is not wired yet, so the folder is inserted directly.
      folder: async (name) =>
        (
          await owner.db.insert(folders).values({ workspaceId, name }).returning({ id: folders.id })
        )[0]!.id,
      pendingApproval: async () => {
        const runId = await seedRun(owner.db, {
          workspaceId,
          status: "waiting",
          waitReason: "approval",
        });
        const [row] = await owner.db
          .insert(approvals)
          .values({
            runId,
            stepSeq: 1,
            kind: "risky_click",
            request: {
              kind: "risky_click",
              action: { type: "click", x: 1, y: 1, button: "left" },
              label: "Delete",
              url: "https://example.com/",
              screenshotKey: null,
            },
          })
          .returning({ id: approvals.id });
        return row!.id;
      },
    },
  ],
];
const live = () => worlds[1]![1];

beforeAll(async () => {
  tdb = await startTestDatabase({ slots: ["browser-1", "browser-2"] });
  owner = createDb(tdb.ownerUrl, { max: 2 });
  web = createDb(tdb.webUrl, { max: 4 });
  await owner.sql`insert into "user" (id, name, email) values (${viewer.id}, ${viewer.name}, ${viewer.email})`;
  ({ workspaceId } = await ensureWorkspaceMember(web.db, viewer.id));
  liveRouter = createLiveRouter({
    db: () => web,
    sealer: () => createSealer(TEST_PUBLIC),
  });
});
afterAll(async () => {
  await Promise.all([web?.close(), owner?.close()]);
  await tdb?.stop();
});

it("probes every procedure outside benchmarks.*", () => {
  const all = Object.entries(apiContract)
    .filter(([group]) => group !== UNTIL_T18)
    .flatMap(([group, procedures]) => Object.keys(procedures).map((name) => `${group}/${name}`));
  expect(EVERY_CALL.map(([path]) => path).sort()).toEqual(all.sort());
  for (const path of LIVE_DEFERRED) expect(all, path).toContain(path);
});

describe.each(worlds)("the API contract on %s (P7-14)", (_name, world) => {
  const served = (path: string) => !world.deferred.has(path);

  it("rejects every procedure without a session as UNAUTHORIZED", async () => {
    const api = world.anonymous();
    for (const [path, input] of EVERY_CALL)
      expect(await outcome(call(api, path)(input())), path).toBe("UNAUTHORIZED");
  });

  it("answers unknown ids with NOT_FOUND and reads with contract-valid output", async () => {
    const api = world.session();
    for (const [path, input, expected] of PROBES.filter(([path]) => served(path)))
      expect(await outcome(call(api, path)(input)), path).toBe(
        expected === "ok" ? "ok" : "NOT_FOUND",
      );
  });

  it("creates a run whose scope reads back normalised, and checks the target folder", async () => {
    const api = world.session();
    const folderId = await world.folder(`Parity ${crypto.randomUUID().slice(0, 8)}`);
    const run = await api.runs.create({
      goal: "parity",
      allowedOrigins: ["example.com/path"],
      targetFolderId: folderId,
    });
    expect(run).toMatchObject({ status: "queued", approvalMode: "ask", controller: "agent" });
    const detail = await api.runs.get({ runId: run.id });
    expect(detail.allowedOrigins).toEqual(["https://example.com"]);
    expect(detail.targetFolderId).toBe(folderId);
    expect(
      await outcome(
        api.runs.create({
          goal: "x",
          allowedOrigins: ["https://example.com"],
          targetFolderId: MISSING,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses bypass without the acknowledgement (D44)", async () => {
    const api = world.session();
    expect(
      await outcome(
        api.runs.create({
          goal: "x",
          allowedOrigins: ["https://example.com"],
          approvalMode: "bypass",
        }),
      ),
    ).toBe("BAD_REQUEST");
    const run = await api.runs.create({
      goal: "x",
      allowedOrigins: ["https://example.com"],
      approvalMode: "bypass",
      bypassAcknowledged: true,
    });
    expect(run.approvalMode).toBe("bypass");
  });

  it("refuses new runs while the kill switch is on", async () => {
    const api = world.session();
    await api.settings.setKillSwitch({ on: true });
    try {
      expect(
        await outcome(api.runs.create({ goal: "x", allowedOrigins: ["https://example.com"] })),
      ).toBe("CONFLICT");
    } finally {
      await api.settings.setKillSwitch({ on: false });
    }
    await expect(
      api.runs.create({ goal: "x", allowedOrigins: ["https://example.com"] }),
    ).resolves.toMatchObject({ status: "queued" });
  });

  it("cancels idempotently and refuses messages and resumes to a finished run", async () => {
    const api = world.session();
    const run = await api.runs.create({
      goal: "cancel me",
      allowedOrigins: ["https://example.com"],
    });
    await expect(api.runs.cancel({ runId: run.id })).resolves.toEqual({ ok: true });
    await expect(api.runs.cancel({ runId: run.id })).resolves.toEqual({ ok: true });
    expect((await api.runs.get({ runId: run.id })).status).toBe("cancelled");
    expect(await outcome(api.runs.sendMessage({ runId: run.id, text: "late" }))).toBe("CONFLICT");
    expect(await outcome(api.runs.resume({ runId: run.id }))).toBe("CONFLICT");
  });

  it("decides an approval once; a second decision is CONFLICT", async () => {
    const api = world.session();
    const approvalId = await world.pendingApproval();
    await expect(api.runs.decideApproval({ approvalId, decision: "approved" })).resolves.toEqual({
      ok: true,
    });
    expect(await outcome(api.runs.decideApproval({ approvalId, decision: "denied" }))).toBe(
      "CONFLICT",
    );
  });

  it.skipIf(!served("folders/create"))(
    "keeps folder names unique per parent and depth at 8",
    async () => {
      const api = world.session();
      const name = `Unique ${crypto.randomUUID().slice(0, 8)}`;
      const root = await api.folders.create({ name });
      expect(await outcome(api.folders.create({ name }))).toBe("CONFLICT");
      let parent = root.id;
      for (let depth = 2; depth <= 8; depth++)
        parent = (await api.folders.create({ name: `L${depth}`, parentId: parent })).id;
      expect(await outcome(api.folders.create({ name: "Ninth", parentId: parent }))).toBe(
        "BAD_REQUEST",
      );
    },
  );

  it("refuses a stale settings version, and the kill switch never changes it (D14)", async () => {
    const api = world.session();
    const before = await api.settings.get({});
    const after = await api.settings.update({ version: before.version, concurrency: 1 });
    expect(after.version).not.toBe(before.version);
    expect(await outcome(api.settings.update({ version: before.version, concurrency: 2 }))).toBe(
      "CONFLICT",
    );
    expect((await api.settings.setKillSwitch({ on: false })).version).toBe(after.version);
  });

  it("reports usage as one entry per day of the range (D52)", async () => {
    const report = await world.session().settings.usage({ from: "2026-10-01", to: "2026-10-07" });
    expect(report.perDay.map((d) => d.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  // UNTIL_P3_B2: one hit per note is B2's hybridSearch rule. Until live serves notes.search there
  // is nothing to agree with, and the fixture still returns a hit per matching block; whoever
  // wires notes.search makes the fixture search agree and runs this on both routers.
  it.skipIf(LIVE_DEFERRED.has("notes/search"))(
    "returns at most one search hit per note",
    async () => {
      const { items } = await world.session().notes.search({ q: "the" });
      expect(new Set(items.map((i) => i.noteId)).size).toBe(items.length);
    },
  );
});

describe("liveRouter is fully wired outside benchmarks.* and the deferred procedures (P7-2, X1)", () => {
  it("never answers NOT_IMPLEMENTED", async () => {
    const api = live().session();
    const unwired: string[] = [];
    for (const [path, input] of EVERY_CALL.filter(([path]) => !LIVE_DEFERRED.has(path)))
      if ((await outcome(call(api, path)(input()))) === "NOT_IMPLEMENTED") unwired.push(path);
    expect(unwired).toEqual([]);
  });

  it("still answers NOT_IMPLEMENTED for benchmarks.* (T18 deletes this case)", async () => {
    expect(await outcome(live().session().benchmarks.list({}))).toBe("NOT_IMPLEMENTED");
  });

  it("still answers NOT_IMPLEMENTED for each deferred procedure (wiring one means deleting it from UNTIL_P2_B6 or UNTIL_P3_B2)", async () => {
    const api = live().session();
    const inputs = new Map(EVERY_CALL);
    for (const path of LIVE_DEFERRED)
      expect(await outcome(call(api, path)(inputs.get(path)!())), path).toBe("NOT_IMPLEMENTED");
  });
});
