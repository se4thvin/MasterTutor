import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { SITE } from "../../behaviour/constants.ts";
import { E2E_SCENARIO } from "../../llm-mock/src/scenarios/e2e.ts";
import { scenarioGoal } from "../../llm-mock/src/select.ts";
import { APP, compose, enabled, publishedPort, request, rpc, state, waitFor } from "./stack.ts";

afterAll(() => {
  if (enabled) compose(["start", "openobserve", "otel-collector"]);
});

const health = (service: string) => {
  const out = compose(["ps", "--format", "json", service]).trim();
  const rows = (
    out.startsWith("[") ? JSON.parse(out) : out.split("\n").map((l) => JSON.parse(l))
  ) as Array<{
    Health: string;
  }>;
  return rows[0]?.Health ?? "";
};

describe.runIf(enabled)(
  "the product keeps working with the collector and OpenObserve down (spec §7.1)",
  () => {
    it("web answers fast, runs still run, containers start and stop, and drops are counted", async () => {
      const fluent = publishedPort("otel-collector", 24224);
      compose(["stop", "otel-collector", "openobserve"]);

      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        const reply = await request(APP, "/sign-in");
        expect(reply.status).toBe(200);
        expect(performance.now() - started).toBeLessThan(2_000);
      }

      // The agent restarts (preload, SDK start) and still runs a run to its end.
      compose(["restart", "agent"]);
      await waitFor(async () => (health("agent") === "healthy" ? true : null), 120_000);
      const { owner } = state();
      const run = await rpc<{ id: string }>(owner, "runs/create", {
        goal: scenarioGoal(E2E_SCENARIO.modelRejected, `Read ${SITE}/`),
        allowedOrigins: [SITE],
        approvalMode: "ask",
      });
      await waitFor(async () => {
        const detail = await rpc<{ status: string }>(owner, "runs/get", { runId: run.id });
        return detail.status === "failed" ? true : null;
      }, 90_000);

      // A container logging through the fluentd driver (production's options) starts, runs and
      // exits normally with nothing listening, and `docker logs` still shows its line.
      const name = `mt-ci-obs-${randomUUID().slice(0, 8)}`;
      const marker = `collector-down-${randomUUID()}`;
      const runId = process.env["MT_CI_RUN_ID"];
      execFileSync("docker", [
        "run",
        "--name",
        name,
        ...(runId ? ["--label", "mastertutor.ci=1", "--label", `mastertutor.ci.run=${runId}`] : []),
        "--log-driver",
        "fluentd",
        "--log-opt",
        `fluentd-address=${fluent}`,
        "--log-opt",
        "fluentd-async=true",
        "--log-opt",
        "mode=non-blocking",
        "--log-opt",
        "cache-max-size=10m",
        "busybox:1.37",
        "echo",
        marker,
      ]);
      try {
        expect(execFileSync("docker", ["logs", name], { encoding: "utf8" })).toContain(marker);
      } finally {
        execFileSync("docker", ["rm", "-f", name]);
      }

      // Exports fail and are dropped, counted and said once a minute (telemetry_dropped).
      await waitFor(
        async () =>
          compose(["logs", "--since", "5m", "web", "agent"]).includes(
            '"errorCode":"telemetry_dropped"',
          )
            ? true
            : null,
        120_000,
      );
      expect(health("web")).toBe("healthy");
    }, 420_000);
  },
);
