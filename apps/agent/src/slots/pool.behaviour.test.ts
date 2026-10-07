import { createLogger } from "@mastertutor/contracts/server";
import { describe, expect, it } from "vitest";
import { cdpBaseUrlForTests } from "../../../../tests/behaviour/constants.ts";
import { containerTimes } from "../../../../tests/behaviour/slot-tools.ts";
import { runtimeConfig } from "../runtime/config.ts";
import { SlotPool } from "./pool.ts";

const log = createLogger({ service: "test", level: "silent" });
const SLOT = "browser-2";

describe("slot recycling (spec §5.2 rule 5)", () => {
  // Every release restarts the slot's container. Docker doubles its restart delay (up to a minute)
  // for a container that ran under 10 s, so back-to-back short runs would leave the slot
  // restarting for a minute at a time: the queue stalls (e2e run-stream, group-2-report.md §12).
  // Red on an image without exit-on-chromium's minimum uptime: its runs last about 5 s and the delays climb to 13 s.
  it("recycles a slot back to back without Docker's restart backoff growing", async () => {
    const pool = new SlotPool({
      store: {
        markIdle: async () => true,
        reclaimExpired: async () => [],
        listRestarting: async () => [],
      },
      slots: [SLOT],
      cdpBaseUrl: cdpBaseUrlForTests,
      config: runtimeConfig(),
      log,
    });
    const runs: number[] = [];
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = await containerTimes(SLOT);
      await pool.reset(SLOT);
      const after = await containerTimes(SLOT);
      expect(after.startedAt, `restart ${i + 1} restarted the container`).toBeGreaterThan(
        before.startedAt,
      );
      runs.push(after.finishedAt - before.startedAt);
      delays.push(after.startedAt - after.finishedAt);
    }
    console.info(JSON.stringify({ metric: "slot_recycle_ms", runs, delays }));
    // Docker resets its restart delay to 100 ms after a run of 10 s or more, so a slot that always
    // lives that long never backs off. The delay itself is container start time, which host load
    // stretches (0.4-3.3 s seen, once 11 s): it measures load, not backoff.
    for (const [i, ran] of runs.entries())
      expect(ran, `run ${i + 1}`).toBeGreaterThanOrEqual(10_000);
  }, 600_000);
});
