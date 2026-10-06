import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import { COMPOSE_FILE, SLOT_CDP, nekoBaseUrlForTests } from "./constants.ts";

const run = promisify(execFile);
const compose = async (...args: string[]) =>
  (await run("docker", ["compose", "-f", COMPOSE_FILE, ...args], { maxBuffer: 10 * 1024 * 1024 }))
    .stdout;

/** XTest input on the slot's X display: the same path n.eko uses for the user's input. */
export function xdotool(slotName: string, ...args: string[]): Promise<string> {
  return compose("exec", "-T", "-u", "neko", "-e", "DISPLAY=:99.0", slotName, "xdotool", ...args);
}

const answers = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    (response) => response.ok,
    () => false,
  );

/** Restarts a slot so it runs the boot profile again, then waits for CDP and n.eko. */
export async function restartSlot(slotName: string): Promise<void> {
  await compose("restart", slotName);
  await waitFor(
    async () =>
      (await answers(`${SLOT_CDP[slotName]}/json/version`)) &&
      (await answers(`${nekoBaseUrlForTests(slotName)}/health`)),
    { label: `${slotName} back after restart`, timeoutMs: 90_000, intervalMs: 500 },
  );
}
