import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Uuid } from "@mastertutor/contracts";

/**
 * The shared `downloads` volume survives slot restarts, so a released run's folder is removed
 * explicitly (Phase 0 amendment). The id is validated as a UUID before it touches the path.
 */
export async function clearRunDownloads(root: string, runId: string): Promise<void> {
  const id = Uuid.parse(runId);
  await rm(join(root, id), { recursive: true, force: true });
}
