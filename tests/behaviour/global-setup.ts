import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { startTestDatabase } from "@mastertutor/db/testing";
import type { TestProject } from "vitest/node";
import { BEHAVIOUR_DOWNLOADS, BEHAVIOUR_SLOTS, COMPOSE_UP_FILES } from "./constants.ts";

const run = promisify(execFile);
const compose = (...args: string[]) =>
  run("docker", ["compose", ...COMPOSE_UP_FILES.flatMap((file) => ["-f", file]), ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

/** Starts the slots, fixtures and a migrated Postgres once for the behaviour project. */
export default async function setup(project: TestProject) {
  await mkdir(BEHAVIOUR_DOWNLOADS, { recursive: true });
  await compose("up", "-d", "--wait");
  const database = await startTestDatabase({ slots: [...BEHAVIOUR_SLOTS] });
  project.provide("behaviour", {
    ownerUrl: database.ownerUrl,
    agentUrl: database.agentUrl,
    webUrl: database.webUrl,
  });
  return async () => {
    await database.stop();
    if (process.env.KEEP_BEHAVIOUR_STACK !== "1") await compose("down", "-v");
  };
}
