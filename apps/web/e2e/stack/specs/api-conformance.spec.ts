import { apiContract } from "@mastertutor/contracts";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { SITE } from "../../../../../tests/behaviour/constants.ts";
import { scenarioGoal } from "../../../../../tests/llm-mock/src/select.ts";
import { BASE_URL, SIGNED_OUT } from "../support/env.ts";
import { rpcCall, rpcOk } from "../support/rpc.ts";

const MISSING = "00000000-0000-4000-8000-00000000dead";
const today = new Date().toISOString().slice(0, 10);
type Expectation = "ok" | "not_found";

/** Reads, and writes aimed at an id that does not exist. */
const PROBES: ReadonlyArray<readonly [string, unknown, Expectation]> = [
  ["runs/list", { limit: 1 }, "ok"],
  ["runs/get", { runId: MISSING }, "not_found"],
  ["runs/steps", { runId: MISSING }, "not_found"],
  ["runs/cancel", { runId: MISSING }, "not_found"],
  ["runs/resume", { runId: MISSING }, "not_found"],
  ["runs/sendMessage", { runId: MISSING, text: "probe" }, "not_found"],
  ["runs/decideApproval", { approvalId: MISSING, decision: "denied" }, "not_found"],
  ["runs/submitOtp", { runId: MISSING, code: "123456" }, "not_found"],
  ["runs/takeControl", { runId: MISSING }, "not_found"],
  ["runs/handBack", { runId: MISSING }, "not_found"],
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
  ["folders/rename", { folderId: MISSING, name: "Probe" }, "not_found"],
  ["folders/move", { folderId: MISSING, parentId: null }, "not_found"],
  ["folders/delete", { folderId: MISSING }, "not_found"],
  ["vault/list", {}, "ok"],
  ["vault/setSecret", { itemId: MISSING, field: "password", value: "probe" }, "not_found"],
  ["vault/removeSecret", { itemId: MISSING, field: "password" }, "not_found"],
  ["vault/delete", { itemId: MISSING }, "not_found"],
  // Idempotent (B3 E6): forgetting nothing is ok and audited as outcome "none" (P7-13).
  ["vault/forgetSession", { alias: "no-such-alias", origin: "https://probe.example" }, "ok"],
  ["vault/audit", { limit: 1 }, "ok"],
  ["settings/get", {}, "ok"],
  ["settings/setKillSwitch", { on: false }, "ok"],
  ["settings/usage", { from: today, to: today }, "ok"],
  ["assets/url", { assetId: MISSING }, "not_found"],
  ["benchmarks/list", {}, "ok"],
  ["benchmarks/start", { benchmarkId: MISSING }, "not_found"],
  ["benchmarks/runs", {}, "ok"],
  ["benchmarks/grade", { benchmarkRunId: MISSING, outcome: "failed" }, "not_found"],
  ["alerts/list", {}, "ok"],
  ["alerts/active", {}, "ok"],
  ["alerts/acknowledge", { id: MISSING }, "not_found"],
  ["alerts/pushConfig", {}, "ok"],
  // Idempotent: turning off a subscription that is not there is ok.
  ["alerts/unsubscribe", { endpoint: "https://web.push.apple.com/probe" }, "ok"],
  ["alerts/pushStatus", { endpoint: "https://web.push.apple.com/probe" }, "ok"],
];
/** Writes that create something; the create test below cleans up after each. */
const CREATES: Record<string, unknown> = {
  "runs/create": { goal: "probe", allowedOrigins: [SITE] },
  "folders/create": { name: "Probe" },
  "vault/create": {
    alias: "probe",
    origin: "https://probe.example",
    label: "Probe",
    secrets: {},
    imap: null,
  },
  "benchmarks/create": {
    name: "probe",
    task: "probe",
    allowedOrigins: [SITE],
    successCriteria: "probe",
  },
  // The stack is plain http without VAPID keys, so a real subscribe is PRECONDITION_FAILED there.
  "alerts/subscribe": {
    endpoint: "https://web.push.apple.com/probe",
    keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
  },
};
/**
 * Writes that need a value read first: settings/update carries the SettingsView.version it read
 * (Task 0, D14). This stale version is only sent without a session; the round-trip test reads one.
 */
const SEQUENCED: Record<string, unknown> = { "settings/update": { concurrency: 1, version: "0" } };

const ALL = Object.entries(apiContract).flatMap(([router, procedures]) =>
  Object.keys(procedures).map((name) => `${router}/${name}`),
);
const BENCHMARKS_FIXME = "benchmarks.* is wired by Phase 10 Task 18, which removes this fixme";
const LIBRARY_FIXME =
  "notes.*, folders.* and assets.url are wired by Task 0C once B2/B4/B5 (P3) merges; it removes this fixme";
/** Why a procedure's live probe is still a fixme, or null once it is wired. */
function unwired(path: string): string | null {
  if (path.startsWith("benchmarks/")) return BENCHMARKS_FIXME;
  if (/^(notes|folders)\//.test(path) || path === "assets/url") return LIBRARY_FIXME;
  return null;
}

/** The contract's own output schema for a procedure (P7-15): probes parse, not just check status. */
function outputSchema(path: string): { parse(value: unknown): unknown } {
  const [router, name] = path.split("/") as [string, string];
  const contract = apiContract as unknown as Record<
    string,
    Record<string, { "~orpc": { outputSchema: { parse(value: unknown): unknown } } }>
  >;
  const procedure = contract[router]?.[name];
  if (!procedure) throw new Error(`${path} is not in apiContract`);
  return procedure["~orpc"].outputSchema;
}

test.describe("oRPC conformance over HTTP (Review Focus 1)", () => {
  test("every contract procedure is probed", () => {
    expect(
      [...PROBES.map(([path]) => path), ...Object.keys(CREATES), ...Object.keys(SEQUENCED)].sort(),
    ).toEqual([...ALL].sort());
  });

  for (const [path, input, expectation] of PROBES) {
    test(`${path} ${expectation === "ok" ? "answers with its contract output" : "is NOT_FOUND for an unknown id"}`, async ({
      request,
    }) => {
      test.fixme(unwired(path) !== null, unwired(path) ?? "");
      const result = await rpcCall(request, path, input);
      expect(result.status, `${path}: HTTP ${result.status} ${result.code ?? ""}`).not.toBe(500);
      if (expectation === "ok") {
        expect(result.status).toBe(200);
        expect(() => outputSchema(path).parse(result.json)).not.toThrow();
      } else {
        expect(result.status).toBe(404);
        expect(result.code).toBe("NOT_FOUND");
      }
    });
  }

  test("every procedure refuses a request without a session (401)", async () => {
    const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL, ...SIGNED_OUT });
    try {
      const inputs = [
        ...PROBES.map(([p, i]) => [p, i] as const),
        ...Object.entries(CREATES),
        ...Object.entries(SEQUENCED),
      ];
      for (const [path, input] of inputs) {
        const result = await rpcCall(anonymous, path, input);
        expect(result.status, path).toBe(401);
        expect(result.code, path).toBe("UNAUTHORIZED");
      }
    } finally {
      await anonymous.dispose();
    }
  });

  test("every procedure answers malformed input with BAD_REQUEST, never a 500", async ({
    request,
  }) => {
    for (const path of ALL) {
      const result = await rpcCall(request, path, "not an object");
      expect(result.status, path).toBe(400);
      expect(result.code, path).toBe("BAD_REQUEST");
    }
  });

  test("a cross-site write is refused before any procedure runs (E2)", async ({ request }) => {
    const response = await request.post("/api/rpc/settings/setKillSwitch", {
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      data: { json: { on: true } },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(403);
    const settings = outputSchema("settings/get").parse(
      await rpcOk(request, "settings/get", {}),
    ) as {
      killSwitch: boolean;
    };
    expect(settings.killSwitch).toBe(false);
  });

  test("create procedures return their contract output, and what they create can be removed", async ({
    request,
  }) => {
    const item = outputSchema("vault/create").parse(
      await rpcOk(request, "vault/create", CREATES["vault/create"]),
    ) as { id: string };
    await rpcOk(request, "vault/delete", { itemId: item.id });

    // A run the mock holds in its first turn, so the cancel never races a finish (P7-16).
    const goal = scenarioGoal("long-wait", `Wait on ${SITE}/`);
    const run = outputSchema("runs/create").parse(
      await rpcOk(request, "runs/create", { ...(CREATES["runs/create"] as object), goal }),
    ) as { id: string };
    await rpcOk(request, "runs/cancel", { runId: run.id });
    await expect
      .poll(
        async () =>
          ((await rpcOk(request, "runs/get", { runId: run.id })) as { status: string }).status,
        { timeout: 30_000 },
      )
      .toBe("cancelled");
  });

  test("folders/create returns its contract output, and the folder can be removed", async ({
    request,
  }) => {
    test.fixme(true, LIBRARY_FIXME);
    const folder = outputSchema("folders/create").parse(
      await rpcOk(request, "folders/create", CREATES["folders/create"]),
    ) as { id: string };
    await rpcOk(request, "folders/delete", { folderId: folder.id });
  });

  test("benchmarks/create returns its contract output", async ({ request }) => {
    test.fixme(true, BENCHMARKS_FIXME);
    const created = outputSchema("benchmarks/create").parse(
      await rpcOk(request, "benchmarks/create", CREATES["benchmarks/create"]),
    ) as { id: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("settings/update round-trips the current settings with their version", async ({
    request,
  }) => {
    const current = outputSchema("settings/get").parse(
      await rpcOk(request, "settings/get", {}),
    ) as {
      concurrency: number;
      version: string;
    };
    const updated = outputSchema("settings/update").parse(
      await rpcOk(request, "settings/update", {
        concurrency: current.concurrency,
        version: current.version,
      }),
    ) as { concurrency: number };
    expect(updated.concurrency).toBe(current.concurrency);
  });
});
