// Runs before every behaviour test file (vitest.config.ts setupFiles). The files share one stack:
// one Postgres and the two slots. Without a reset, what a file leaves behind decides how the next
// one behaves: runs still queued, running or asleep are claimed by the next file's Supervisor and
// take its slots; a held slot lease or a stale n.eko session fails the next file's live view. So
// every file starts from the same state, whatever ran before it:
//   - no runs (their steps, events and approvals go with them) and the kill switch off;
//   - both slots freshly restarted (browser profile wiped, no n.eko session) and idle, unleased.
import { browserSlots, createDb, runs, settings } from "@mastertutor/db";
import { beforeAll } from "vitest";
import { BEHAVIOUR_SLOTS } from "./constants.ts";
import { behaviourEnv } from "./env.ts";
import { restartSlot } from "./slot-tools.ts";

beforeAll(async () => {
  const owner = createDb(behaviourEnv().ownerUrl, { max: 1 });
  try {
    await owner.db.delete(runs);
    await owner.db.update(settings).set({ killSwitch: false });
    await Promise.all(BEHAVIOUR_SLOTS.map((slot) => restartSlot(slot)));
    await owner.db
      .update(browserSlots)
      .set({ state: "idle", runId: null, leaseOwner: null, leaseExpiresAt: null });
  } finally {
    await owner.close();
  }
});
