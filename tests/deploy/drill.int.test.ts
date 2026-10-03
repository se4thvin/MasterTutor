import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeConfig } from "../compose/compose-json.ts";

const RUN = "mt-phase9-test-0a0b0c";

describe("restore drill on the shared host (review I6)", () => {
  it("builds a throwaway, labelled image instead of retagging a shared one", () => {
    const drill = composeConfig(".env.test", ["compose.yml", "scripts/deploy/compose.drill.yml"], {
      env: { MT_CI_RUN_ID: RUN },
    });
    const migrate = drill.services.migrate!;
    expect(migrate.image).toBe(`mt-ci-drill-runtime:${RUN}`);
    expect((migrate.build as { labels?: Record<string, string> }).labels).toMatchObject({
      "mastertutor.ci": "1",
      "mastertutor.ci.run": RUN,
    });
  });

  it("removes that image when it ends, and the runner's cleanup removes it too", () => {
    const drill = readFileSync("scripts/deploy/restore-drill.sh", "utf8");
    const trap = drill.split("\n").find((line) => line.startsWith("trap "));
    expect(trap).toContain('docker image rm -f "$IMAGE"');
    const runner = readFileSync("scripts/remote-test/run-on-host.sh", "utf8");
    expect(runner).toContain('docker image rm -f "mt-ci-drill-runtime:$project"');
  });
});

/** The shell command the remote runner gives a suite. */
function suiteCommand(suite: string): string {
  const runner = readFileSync("scripts/remote-test/run-on-host.sh", "utf8");
  const match = new RegExp(`\\n\\s*${suite}\\)\\n(?:\\s*#.*\\n)*\\s*command=(["'])(.*?)\\1`).exec(
    runner,
  );
  if (!match) throw new Error(`no ${suite} command`);
  return match[2]!;
}

describe("the remote smoke suite (review I9)", () => {
  it("runs the drill, and nothing follows an exec", () => {
    const steps = suiteCommand("smoke")
      .split("&&")
      .map((step) => step.trim());
    expect(steps.at(-1)).toMatch(/bash scripts\/deploy\/restore-drill\.sh$/);
    for (const step of steps.slice(0, -1)) expect(step, step).not.toMatch(/^exec\b/);
  });
});
