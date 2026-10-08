import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNekoAdmin } from "../../apps/agent/src/live/neko-admin.ts";
import { waitFor } from "../../apps/agent/src/testing/wait.ts";
import {
  BEHAVIOUR_NEKO_ADMIN_SECRET,
  COMPOSE_FILE,
  SLOT_CDP,
  nekoBaseUrlForTests,
} from "./constants.ts";

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

/** The slot container's last exit and current start, as Docker records them. */
export async function containerTimes(
  slotName: string,
): Promise<{ finishedAt: number; startedAt: number }> {
  const id = (await compose("ps", "-a", "-q", slotName)).trim();
  const out = await run("docker", [
    "inspect",
    "-f",
    "{{.State.FinishedAt}} {{.State.StartedAt}}",
    id,
  ]);
  const [finished, started] = out.stdout.trim().split(" ");
  return { finishedAt: Date.parse(finished!), startedAt: Date.parse(started!) };
}

const nekoAdmin = createNekoAdmin({
  adminSecret: BEHAVIOUR_NEKO_ADMIN_SECRET,
  baseUrl: nekoBaseUrlForTests,
});

/**
 * Ends the slot's connected n.eko viewer (`user`) session, the way revocation does. A test that
 * opened a viewer socket on a slot it does not restart calls it: n.eko notices a closed socket
 * only later, and until then the next file's viewer login answers 422.
 */
export async function endNekoViewer(slotName: string): Promise<void> {
  const sessions = (await nekoAdmin.request(slotName, "GET", "/api/sessions")) as Array<{
    id: string;
    state?: { is_connected?: boolean };
  }>;
  if (sessions.some((session) => session.id === "user" && session.state?.is_connected))
    await nekoAdmin.request(slotName, "POST", "/api/sessions/user/disconnect");
}
