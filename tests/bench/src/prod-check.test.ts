import { describe, expect, it } from "vitest";
import { runningModeProblems, type InspectedContainer } from "./prod-check.ts";

const prod: InspectedContainer[] = [
  {
    service: "web",
    env: ["NODE_ENV=production", "OPENAI_API_KEY=sk-canary-DO-NOT-PRINT"],
    cmd: ["node", "apps/web/server.js"],
  },
  {
    service: "agent",
    env: ["NODE_ENV=production", "AGENT_TEST_MODE=0"],
    cmd: ["node", "apps/agent/src/main.ts"],
  },
];

describe("runningModeProblems (D47, running containers)", () => {
  it("accepts production containers", () => {
    expect(runningModeProblems(prod)).toEqual([]);
  });
  it("refuses dev servers, test mode, the fixture API and test-only services", () => {
    const text = runningModeProblems([
      { service: "web", env: ["NODE_ENV=development", "WEB_FIXTURE_API=1"], cmd: ["pnpm", "dev"] },
      {
        service: "agent",
        env: ["NODE_ENV=production", "AGENT_TEST_MODE=1"],
        cmd: ["node", "apps/agent/src/main.ts"],
      },
      { service: "llm-mock", env: [], cmd: [] },
    ]).join("\n");
    for (const needle of [
      "web.NODE_ENV",
      "web.WEB_FIXTURE_API",
      "web.command",
      "agent.AGENT_TEST_MODE",
      "llm-mock",
    ])
      expect(text).toContain(needle);
  });
  it("accepts the stack's loopback Traefik only for the local prod-like stack (final review I1)", () => {
    const withIngress = [...prod, { service: "traefik", env: [], cmd: [] }];
    expect(runningModeProblems(withIngress, { localIngress: true })).toEqual([]);
    expect(runningModeProblems(withIngress)).toEqual(["traefik: test-only service is running"]);
    // The exception names one service: a renamed test service is still refused.
    expect(
      runningModeProblems([...prod, { service: "proxy", env: [], cmd: [] }], {
        localIngress: true,
      }),
    ).toEqual(["proxy: test-only service is running"]);
  });
  it("requires web and agent to be running", () => {
    expect(runningModeProblems([])).toEqual(["web: not running", "agent: not running"]);
  });
  it("names keys only, never values", () => {
    const leaky = prod.map((c) =>
      c.service === "web" ? { ...c, env: [...c.env, "WEB_FIXTURE_API=sk-canary-DO-NOT-PRINT"] } : c,
    );
    expect(runningModeProblems(leaky).join("\n")).not.toContain("sk-canary");
  });
});
