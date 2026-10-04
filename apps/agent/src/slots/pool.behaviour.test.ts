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
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await pool.reset(SLOT);
      const { finishedAt, startedAt } = await containerTimes(SLOT);
      delays.push(startedAt - finishedAt);
    }
    // Without backoff each restart waits only for Docker to start the container (0.4-3.3 s seen on
    // the CI host); doubling from 100 ms reaches 12.8 s by the 8th restart.
    for (const [i, delay] of delays.entries())
      expect(delay, `restart ${i + 1}`).toBeLessThan(10_000);
  }, 600_000);
});
