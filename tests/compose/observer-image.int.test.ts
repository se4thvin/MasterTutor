import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

it("boots the observer production modules and validates its baked code index without network access", () => {
  const tag = `mt-ci-observer-image-check:${randomUUID()}`;
  const runId = process.env["MT_CI_RUN_ID"];
  const labels = [
    "--label",
    "mastertutor.ci=1",
    ...(runId ? ["--label", `mastertutor.ci.run=${runId}`] : []),
  ];
  try {
    execFileSync(
      "docker",
      ["build", "--quiet", ...labels, "--target", "observer", "-t", tag, "."],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 },
    );
    const reply = execFileSync(
      "docker",
      [
        "run",
        "--rm",
        ...labels,
        "--network",
        "none",
        "--read-only",
        tag,
        "node",
        "--import",
        "./packages/telemetry/src/register-observer.ts",
        "--input-type=module",
        "-e",
        "await import('./apps/observer/src/routes.ts'); const {createQueryProxyServer} = await import('./apps/observer/src/query-proxy.ts'); const {randomBytes} = await import('node:crypto'); const proxy = createQueryProxyServer({}, randomBytes(32).toString('base64url')); proxy.close(); const {ObserverEnv} = await import('./packages/contracts/src/index.ts'); if ('OBSERVE_COPILOT_PASSWORD' in ObserverEnv.shape) throw new Error('credential in copilot'); const {loadCodeIndex} = await import('./apps/observer/src/code-index.ts'); const code = await loadCodeIndex('/app/code-index.json'); if (!code.read('apps/observer/src/main.ts', 1, 10)) throw new Error('missing observer snapshot'); console.log('OBSERVER IMAGE OK');",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    expect(reply.trim()).toBe("OBSERVER IMAGE OK");
  } finally {
    execFileSync("docker", ["image", "rm", "-f", tag], { stdio: "ignore" });
  }
}, 240_000);
