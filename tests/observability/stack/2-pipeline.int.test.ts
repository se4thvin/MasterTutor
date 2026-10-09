import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { ATTR, LOG_STREAMS, RETENTION_DAYS, TRACE_STREAM } from "@mastertutor/contracts/telemetry";
import { o2Label } from "@mastertutor/observability";
import { beforeAll, describe, expect, it } from "vitest";
import { SITE } from "../../behaviour/constants.ts";
import { E2E_SCENARIO } from "../../llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../llm-mock/src/select.ts";
import {
  OBS,
  compose,
  enabled,
  promQuery,
  request,
  rpc,
  saveState,
  search,
  state,
  waitFor,
} from "./stack.ts";

/** What a stream holds so far (services, operations, columns), for a failure message. */
async function seen(obs: string, type: "logs" | "traces", stream: string): Promise<string> {
  const hits = await search(obs, type, `SELECT * FROM "${stream}"`);
  const services = new Set(
    hits.map((h) => `${String(h["service_name"])}/${String(h["operation_name"] ?? "")}`),
  );
  const columns = new Set(hits.flatMap((h) => Object.keys(h)));
  return `${hits.length} hits; ${[...services].slice(0, 20).join(", ")}; columns ${[...columns].join(",")}`;
}

const ALLOWED_MT_COLUMNS = new Set<string>(Object.values(ATTR).map(o2Label));

beforeAll(async () => {
  if (!enabled) return;
  const { owner } = state();
  // A phone, so the alerts this run raises are pushed (3-alerts): the stub push service's host.
  const config = await rpc<{ available: boolean }>(owner, "alerts/pushConfig", {});
  expect(config.available).toBe(true);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const pushPath = `/sub/${randomUUID()}`;
  await rpc(owner, "alerts/subscribe", {
    endpoint: `https://stub.push.services.mozilla.com${pushPath}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  });
  // The forced failure: the model rejects the request, so the run fails with
  // model_request_rejected (both rules, spec §13.1). Its goal is a prompt: it carries a canary
  // that must never reach any telemetry.
  const canary = `CANARY-${randomBytes(8).toString("hex")}`;
  const run = await rpc<{ id: string }>(owner, "runs/create", {
    goal: scenarioGoal(E2E_SCENARIO.modelRejected, `Read ${SITE}/ ${canary}`),
    allowedOrigins: [SITE],
    approvalMode: "ask",
  });
  await waitFor(async () => {
    const detail = await rpc<{ status: string }>(owner, "runs/get", { runId: run.id });
    return detail.status === "failed" ? true : null;
  }, 90_000);
  saveState({ ...state(), runId: run.id, canary, pushPath });
}, 120_000);

describe.runIf(enabled)("telemetry reaches OpenObserve (spec §5–§11)", () => {
  it("the agent's product spans arrive with their product attributes", async () => {
    const { obs, runId } = state();
    const spans = await waitFor(async () => {
      const hits = await search(
        obs,
        "traces",
        `SELECT * FROM "${TRACE_STREAM}" WHERE ${o2Label(ATTR.runId)} = '${runId}'`,
      );
      if (hits.some((h) => h["operation_name"] === "mt.model.request")) return hits;
      throw new Error(`run spans so far: ${await seen(obs, "traces", TRACE_STREAM)}`);
    }, 150_000);
    const model = spans.find((h) => h["operation_name"] === "mt.model.request")!;
    expect(model["service_name"]).toBe("agent");
    expect(model[o2Label(ATTR.errorCode)]).toBe("model_request_rejected");
    expect(model["span_status"]).toBe("ERROR");
    expect(spans.map((h) => h["operation_name"])).toContain("mt.step");
  }, 180_000);

  it("web's spans and both services' logs arrive", async () => {
    const { obs } = state();
    await waitFor(async () => {
      const hits = await search(
        obs,
        "traces",
        `SELECT * FROM "${TRACE_STREAM}" WHERE service_name = 'web'`,
      );
      if (hits.length > 0) return true;
      throw new Error(`traces so far: ${await seen(obs, "traces", TRACE_STREAM)}`);
    }, 120_000);
    for (const service of ["agent", "web"])
      await waitFor(async () => {
        const hits = await search(
          obs,
          "logs",
          `SELECT * FROM "${LOG_STREAMS.app}" WHERE service_name = '${service}'`,
        );
        if (hits.length > 0) return true;
        throw new Error(`logs so far: ${await seen(obs, "logs", LOG_STREAMS.app)}`);
      }, 120_000);
  }, 260_000);

  it("the run's metrics and the derived span metrics arrive", async () => {
    const { obs } = state();
    for (const query of [
      'mt_runs_ended{mt_run_status="failed"}',
      'mt_run_failures{mt_error_code="model_request_rejected"}',
      'mt_span_calls{span_name="mt.step"}',
    ])
      await waitFor(async () => ((await promQuery(obs, query)).length > 0 ? true : null), 150_000);
  }, 460_000);

  it("carries nothing outside the allowlist: no prompt canary anywhere, no unregistered mt.* attribute", async () => {
    const { obs, canary } = state();
    const traces = await search(obs, "traces", `SELECT * FROM "${TRACE_STREAM}"`);
    const logs = [
      ...(await search(obs, "logs", `SELECT * FROM "${LOG_STREAMS.app}"`)),
      ...(await search(obs, "logs", `SELECT * FROM "${LOG_STREAMS.containers}"`)),
    ];
    expect(traces.length).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(traces)).not.toContain(canary!);
    expect(JSON.stringify(logs)).not.toContain(canary!);
    for (const span of traces)
      for (const key of Object.keys(span))
        if (key.startsWith("mt_")) expect(ALLOWED_MT_COLUMNS.has(key), key).toBe(true);
    for (const forbidden of ["url_full", "url_path", "url_query", "http_target"])
      expect(
        traces.some((span) => forbidden in span),
        forbidden,
      ).toBe(false);
  });

  it("keeps D50's retention: logs 30 d, traces 15 d, metrics 90 d", async () => {
    const { obs } = state();
    const settings = async (type: string) => {
      const reply = await request(OBS, `/observability/api/default/streams?type=${type}`, {
        cookie: obs,
      });
      const { list } = JSON.parse(reply.body) as {
        list: Array<{ name: string; settings: { data_retention: number } }>;
      };
      return Object.fromEntries(list.map((s) => [s.name, s.settings.data_retention]));
    };
    const logs = await settings("logs");
    expect(logs[LOG_STREAMS.app]).toBe(RETENTION_DAYS.logs);
    expect(logs[LOG_STREAMS.containers]).toBe(RETENTION_DAYS.logs);
    expect((await settings("traces"))[TRACE_STREAM]).toBe(RETENTION_DAYS.traces);
    const o2 = JSON.parse(compose(["config", "--format", "json"])) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(o2.services["openobserve"]!.environment!["ZO_COMPACT_DATA_RETENTION_DAYS"]).toBe(
      String(RETENTION_DAYS.metrics),
    );
  });
});
