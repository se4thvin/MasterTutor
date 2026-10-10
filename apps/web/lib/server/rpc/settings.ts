import { listCapturePreferences, setCapturePreference } from "../runs/capture-intent.ts";
import type { DbHandle } from "@mastertutor/db";
import { served } from "../service-error.ts";
import { getSettings, setKillSwitch, updateSettings, usageReport } from "../settings/service.ts";
import { workspaceScoped } from "./workspace-scope.ts";

/** settings.* for the live router. Any member may read and change them (D4: one workspace). */
export function createSettingsProcedures(deps: { db(): DbHandle }) {
  const scoped = workspaceScoped(deps.db);
  return {
    capturePreferences: scoped.settings.capturePreferences.handler(({ context }) =>
      served(() => listCapturePreferences(context.db.db, context.workspaceId)),
    ),
    setCapturePreference: scoped.settings.setCapturePreference.handler(
      async ({ context, input }) => {
        await served(() => setCapturePreference(context.db.db, context, input));
        return { ok: true as const };
      },
    ),
    get: scoped.settings.get.handler(({ context }) =>
      served(() => getSettings(context.db.db, context.workspaceId)),
    ),
    update: scoped.settings.update.handler(({ context, input }) =>
      served(() => updateSettings(context.db.db, context.workspaceId, input)),
    ),
    setKillSwitch: scoped.settings.setKillSwitch.handler(({ context, input }) =>
      served(() => setKillSwitch(context.db.db, context.workspaceId, input.on)),
    ),
    usage: scoped.settings.usage.handler(({ context, input }) =>
      served(() => usageReport(context.db.db, context.workspaceId, input)),
    ),
  };
}
