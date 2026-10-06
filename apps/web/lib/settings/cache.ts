import type { SettingsView } from "@mastertutor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";

const settingsKey = () => orpc.settings.get.queryKey({ input: {} });

const pick = <K extends keyof SettingsView>(from: SettingsView, fields: readonly K[]) =>
  Object.fromEntries(fields.map((f) => [f, from[f]])) as Pick<SettingsView, K>;

function patchSettings(qc: QueryClient, fields: Partial<SettingsView>): void {
  qc.setQueryData<SettingsView>(settingsKey(), (old) => old && { ...old, ...fields });
}

/**
 * One settings write. Each writer owns some fields (the kill switch, or the defaults) and only
 * ever merges those into the cache, so a late response from one write can never overwrite
 * another's: the server returns the whole SettingsView, but a defaults save answered before the
 * kill switch went on still says "off". In-flight reads are cancelled first, `optimistic` (if
 * any) applies at once and is rolled back alone on failure, and the cache refetches on settle so
 * the server has the last word. Returns whether the write succeeded.
 */
export async function saveSettingsFields<K extends keyof SettingsView>(
  qc: QueryClient,
  owned: readonly K[],
  send: () => Promise<SettingsView>,
  optimistic?: Pick<SettingsView, K>,
): Promise<boolean> {
  await qc.cancelQueries({ queryKey: settingsKey() });
  const current = qc.getQueryData<SettingsView>(settingsKey());
  const previous = current ? pick(current, owned) : undefined;
  if (optimistic) patchSettings(qc, optimistic);
  try {
    patchSettings(qc, pick(await send(), owned));
    return true;
  } catch {
    if (optimistic && previous) patchSettings(qc, previous);
    return false;
  } finally {
    void qc.invalidateQueries({ queryKey: settingsKey() });
  }
}
