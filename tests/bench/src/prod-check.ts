// D47 harness preflight (owned here). Config level: T12's prodModeProblems over PROD_LIKE_LOCAL_FILES
// (the one definition of production mode). Container level: what is actually running. It reports key
// and service NAMES only, never values. composeConfig reads .env in memory and prints nothing.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { composeConfig } from "../../compose/compose-json.ts";
import {
  PROD_LIKE_LOCAL_FILES,
  isProductionService,
  prodModeProblems,
} from "../../compose/prod-mode.ts";
import { PreconditionFailed } from "./run-suite.ts";

const run = promisify(execFile);
/** The Next.js standalone production server: what `next build && next start` serves (Dockerfile target web). */
const WEB_PROD_CMD = "node apps/web/server.js";

export interface InspectedContainer {
  service: string;
  env: readonly string[];
  cmd: readonly string[];
}

export function runningModeProblems(running: readonly InspectedContainer[]): string[] {
  const problems: string[] = [];
  for (const c of running) {
    if (!isProductionService(c.service))
      problems.push(`${c.service}: test-only service is running`);
  }
  for (const name of ["web", "agent"] as const) {
    const c = running.find((x) => x.service === name);
    if (!c) {
      problems.push(`${name}: not running`);
      continue;
    }
    const keys = new Map(
      c.env.map((e) => [e.slice(0, Math.max(0, e.indexOf("="))), e.slice(e.indexOf("=") + 1)]),
    );
    if (keys.get("NODE_ENV") !== "production")
      problems.push(`${name}.NODE_ENV: must be production`);
    if (keys.has("WEB_FIXTURE_API")) problems.push(`${name}.WEB_FIXTURE_API: must be unset`);
    if (name === "agent" && keys.get("AGENT_TEST_MODE") !== "0")
      problems.push("agent.AGENT_TEST_MODE: must be 0");
    if (name === "web" && c.cmd.join(" ") !== WEB_PROD_CMD)
      problems.push(`web.command: must be ${WEB_PROD_CMD} (next start)`);
  }
  return problems;
}

const PsLine = z.object({ ID: z.string().min(1), Service: z.string().min(1) });
const Inspect = z.array(
  z.object({
    Id: z.string(),
    Config: z.object({ Env: z.array(z.string()).nullable(), Cmd: z.array(z.string()).nullable() }),
  }),
);

export async function assertProdMode(compose: readonly string[]): Promise<void> {
  const config = composeConfig([".env", ".env.bench"], PROD_LIKE_LOCAL_FILES, {
    profiles: ["pdf"],
  });
  const [cmd, ...args] = compose;
  const ps = (await run(cmd!, [...args, "ps", "--format", "json"])).stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => PsLine.parse(JSON.parse(l)));
  const inspected = ps.length
    ? Inspect.parse(
        JSON.parse(
          (await run("docker", ["inspect", ...ps.map((p) => p.ID)], { maxBuffer: 32 << 20 }))
            .stdout,
        ),
      )
    : [];
  const running = inspected.map((i) => ({
    service: ps.find((p) => i.Id.startsWith(p.ID))!.Service,
    env: i.Config.Env ?? [],
    cmd: i.Config.Cmd ?? [],
  }));
  const problems = [...prodModeProblems(config), ...runningModeProblems(running)];
  if (problems.length)
    throw new PreconditionFailed(`not a prod-like stack (D47):\n- ${problems.join("\n- ")}`);
}
