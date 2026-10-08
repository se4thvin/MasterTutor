import type { BenchApi } from "./app-client.ts";
import type { VaultRequirement } from "./types.ts";

/** Null when the vault item is ready, otherwise instructions. It never asks for or accepts a secret (D34). */
export async function checkVaultItem(
  api: BenchApi,
  requirement: VaultRequirement,
): Promise<string | null> {
  const { items } = await api.vault.list({});
  const item = items.find((i) => i.alias === requirement.alias);
  const missing = item
    ? requirement.fields.filter((f) => !item.fields.includes(f))
    : [...requirement.fields];
  if (item && item.origin === requirement.origin && missing.length === 0) return null;
  return [
    `Vault item "${requirement.alias}" is not ready.`,
    "Open the app's Vault page and add or fix the item yourself:",
    `  alias:  ${requirement.alias}`,
    `  origin: ${requirement.origin}${item && item.origin !== requirement.origin ? ` (currently ${item.origin})` : ""}`,
    `  fields: ${requirement.fields.join(", ")}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
    "Type the credentials into the Vault UI only: never into chat, files, commands or env vars (D34).",
  ].join("\n");
}

export class SessionStillSaved extends Error {
  constructor(alias: string) {
    super(
      `A saved session for "${alias}" survived forgetSession, so a run could skip signing in. Not starting (P10b-4).`,
    );
    this.name = "SessionStillSaved";
  }
}

/** Every run signs in from scratch: forget the saved session, then prove it is gone. */
export async function ensureFreshLogin(
  api: BenchApi,
  requirement: VaultRequirement,
): Promise<void> {
  await api.vault.forgetSession({ alias: requirement.alias, origin: requirement.origin });
  const item = (await api.vault.list({})).items.find((i) => i.alias === requirement.alias);
  if (item?.sessionSaved) throw new SessionStillSaved(requirement.alias);
}

/** `pnpm bench vault-check`: what the vault holds for a requirement, by name only. Starts no run. */
export async function vaultStatus(
  api: BenchApi,
  requirement: VaultRequirement,
): Promise<{ ready: boolean; line: string }> {
  const problem = await checkVaultItem(api, requirement);
  if (problem) return { ready: false, line: problem };
  const item = (await api.vault.list({})).items.find((i) => i.alias === requirement.alias)!;
  const line = [
    `Vault item "${requirement.alias}" is ready for ${requirement.origin} (${requirement.fields.join(", ")}).`,
    `Saved session: ${item.sessionSaved ? "yes (the harness forgets it before every run)" : "no"}.`,
    "Never grant a lasting sign-in for this site during benchmarks.",
  ].join("\n");
  return { ready: true, line };
}
