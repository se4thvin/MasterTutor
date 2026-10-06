import type { SettingsView } from "@mastertutor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { orpc } from "@/lib/api/client.ts";
import { saveSettingsFields } from "./cache.ts";

const key = orpc.settings.get.queryKey({ input: {} });
const A = { maxSteps: 50, maxUsd: 2, maxActiveMinutes: 30 };
const B = { maxSteps: 90, maxUsd: 2, maxActiveMinutes: 30 };
const base: SettingsView = {
  killSwitch: false,
  defaultBudget: A,
  defaultAllowedOrigins: [],
  concurrency: 6,
};

function held<T>(value: T) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { send: async () => (await gate, value), release };
}

/** The server processed the defaults save first (kill switch still off), then the kill switch. */
const defaultsResponse: SettingsView = { ...base, defaultBudget: B };
const killResponse: SettingsView = { ...base, defaultBudget: B, killSwitch: true };

async function run(order: "kill-first" | "defaults-first") {
  const qc = new QueryClient();
  qc.setQueryData(key, base);
  const defaults = held(defaultsResponse);
  const kill = held(killResponse);
  const savingDefaults = saveSettingsFields(
    qc,
    ["defaultBudget", "defaultAllowedOrigins"],
    defaults.send,
  );
  const savingKill = saveSettingsFields(qc, ["killSwitch"], kill.send, { killSwitch: true });
  const [first, second] = order === "kill-first" ? [kill, defaults] : [defaults, kill];
  first.release();
  await new Promise((r) => setTimeout(r, 0));
  second.release();
  await Promise.all([savingDefaults, savingKill]);
  return qc;
}

describe("settings saves own their fields (R29-5)", () => {
  it.each(["kill-first", "defaults-first"] as const)(
    "a late response never overwrites the other save (%s)",
    async (order) => {
      const qc = await run(order);
      const cached = qc.getQueryData<SettingsView>(key);
      expect(cached?.killSwitch).toBe(true);
      expect(cached?.defaultBudget).toEqual(B);
      // Both settle with a refetch, so the server has the last word.
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    },
  );

  it("a failed save rolls back only its own fields", async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, base);
    const ok = await saveSettingsFields(
      qc,
      ["killSwitch"],
      async () => {
        qc.setQueryData<SettingsView>(key, (old) => old && { ...old, defaultBudget: B });
        throw new Error("500");
      },
      { killSwitch: true },
    );
    expect(ok).toBe(false);
    expect(qc.getQueryData<SettingsView>(key)).toEqual({ ...base, defaultBudget: B });
  });
});
