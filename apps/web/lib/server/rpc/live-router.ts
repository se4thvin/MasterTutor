import type { PushConfig } from "@mastertutor/contracts";
import type { EmbeddingsClient } from "@mastertutor/contracts/server";
import type { DbHandle } from "@mastertutor/db";
import { getDb } from "../db.ts";
import { getWebEnv } from "../env.ts";
import { getEmbeddingsClient } from "../openai.ts";
import { getLiveDeps } from "../live/deps.ts";
import type { LiveDeps } from "../live/open-live.ts";
import { createLiveHandlers } from "../live/procedures.ts";
import { pushConfigOf } from "../push/config.ts";
import { getSealer, type Sealer } from "../vault/sealer.ts";
import { createAlertProcedures } from "./alerts.ts";
import { createBenchmarkProcedures } from "./benchmarks.ts";
import { createLibraryProcedures } from "./library.ts";
import { liveOs as os } from "./live-os.ts";
import { createRunProcedures } from "./runs.ts";
import { createSettingsProcedures } from "./settings.ts";
import { createVaultProcedures } from "./vault.ts";

/** What the live router reads, each on first use (importing it never reads env or opens the DB). */
interface LiveRouterDeps {
  db(): DbHandle;
  sealer(): Sealer;
  live(): LiveDeps;
  /** Query embeddings for notes.search (the shared stateless factory, D38). */
  embeddings(): EmbeddingsClient;
  /** Whether Web Push can be offered here (VAPID keys and HTTPS, spec §13.4). */
  push(): PushConfig;
}

/** The one RPC router of a production build (fixture builds use lib/fixtures/router.ts). */
export function createLiveRouter(deps: LiveRouterDeps) {
  const vault = createVaultProcedures({ sealer: deps.sealer, db: deps.db });
  const runs = createRunProcedures({ db: deps.db });
  const settings = createSettingsProcedures({ db: deps.db });
  const benchmarks = createBenchmarkProcedures({ db: deps.db });
  /** notes.*, folders.* and assets.url (B2 handlers; Task 0C). */
  const library = createLibraryProcedures({ db: deps.db, embeddings: deps.embeddings });
  /** B6: the live view and the control lock (spec §10.2, §10.3). */
  const live = createLiveHandlers(deps.live);
  /** D50: owner-only alerts and phone alert subscriptions. */
  const alerts = createAlertProcedures({ db: deps.db, push: deps.push });
  return os.router({
    runs: {
      ...runs,
      submitOtp: vault.submitOtp,
      takeControl: os.runs.takeControl.handler(({ input, context }) =>
        live.takeControl(input, context),
      ),
      handBack: os.runs.handBack.handler(({ input, context }) => live.handBack(input, context)),
      openLive: os.runs.openLive.handler(({ input, context }) => live.openLive(input, context)),
    },
    notes: library.notes,
    folders: library.folders,
    vault: vault.vault,
    settings,
    assets: library.assets,
    benchmarks,
    alerts,
  });
}

export const liveRouter = createLiveRouter({
  db: getDb,
  sealer: getSealer,
  live: getLiveDeps,
  embeddings: getEmbeddingsClient,
  push: () => pushConfigOf(getWebEnv()),
});
