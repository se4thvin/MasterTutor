import type { O2Client } from "../client.ts";
import { DashboardList, dashboardRef, o2Paths } from "../o2-api.ts";
import { toO2Dashboard, type DashboardSpec } from "./build.ts";
import { DASHBOARDS } from "./catalog.ts";

/** Creates each dashboard by title, or replaces it in place (UI edits are overwritten, spec §18). */
export async function upsertDashboards(
  client: O2Client,
  dashboards: readonly DashboardSpec[] = DASHBOARDS,
): Promise<void> {
  const list = await client.call(
    "listDashboards",
    "GET",
    o2Paths.dashboards(client.org),
    undefined,
    DashboardList,
  );
  const existing = new Map(
    list.dashboards.flatMap((entry) => {
      const ref = dashboardRef(entry);
      return ref ? [[ref.title, ref] as const] : [];
    }),
  );
  for (const spec of dashboards) {
    const body = toO2Dashboard(spec);
    const ref = existing.get(spec.title);
    if (ref)
      await client.call(
        "updateDashboard",
        "PUT",
        o2Paths.dashboard(client.org, ref.id, ref.hash),
        body,
      );
    else await client.call("createDashboard", "POST", o2Paths.dashboards(client.org), body);
  }
}
