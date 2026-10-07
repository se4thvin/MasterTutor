import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { waitFor } from "../testing/wait.ts";
import { createIdleWatch } from "./idle-watch.ts";

const log = createLogger({ service: "test", level: "silent" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("idle hand-back watch (spec §5.1)", () => {
  it("counts from the takeover, even when the X idle time was already huge (Review Focus 2)", async () => {
    const calls: number[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 99_000_000 },
      limitMs: 80,
      pollMs: 10,
      log,
      onIdle: async () => void calls.push(performance.now()),
    });
    const armedAt = performance.now();
    watch.arm("browser-1", "run-1");
    await waitFor(() => calls.length === 1, { label: "idle hand-back", timeoutMs: 2_000 });
    expect(calls[0]! - armedAt).toBeGreaterThanOrEqual(80);
    await pause(60);
    expect(calls).toHaveLength(1);
  });

  it("never hands back while the user keeps giving input", async () => {
    const calls: string[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 5 },
      limitMs: 40,
      pollMs: 10,
      log,
      onIdle: async (runId) => void calls.push(runId),
    });
    watch.arm("browser-1", "run-2");
    await pause(200);
    watch.disarm("run-2");
    expect(calls).toEqual([]);
  });

  it("keeps watching through probe failures and retries a failed hand-back", async () => {
    let probes = 0;
    let attempts = 0;
    const watch = createIdleWatch({
      probe: {
        userIdleMs: async () => {
          probes += 1;
          if (probes <= 3) throw new Error("slot busy");
          return 99_000_000;
        },
      },
      limitMs: 30,
      pollMs: 10,
      log,
      onIdle: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("db blip");
      },
    });
    watch.arm("browser-1", "run-3");
    await waitFor(() => attempts === 2, { label: "second attempt", timeoutMs: 2_000 });
    await pause(60);
    expect(attempts).toBe(2);
  });

  it("stops when disarmed", async () => {
    const calls: string[] = [];
    const watch = createIdleWatch({
      probe: { userIdleMs: async () => 99_000_000 },
      limitMs: 50,
      pollMs: 10,
      log,
      onIdle: async (runId) => void calls.push(runId),
    });
    watch.arm("browser-1", "run-4");
    watch.disarm("run-4");
    await pause(150);
    expect(calls).toEqual([]);
  });
});
