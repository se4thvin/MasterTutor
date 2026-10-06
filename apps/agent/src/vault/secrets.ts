import type { VaultSecretField } from "@mastertutor/contracts";
import { loadSealedSecret, type DbExecutor, type VaultItemRecord } from "@mastertutor/db";
import { withOpenedText } from "@mastertutor/sealing/open";
import type { VaultDeps } from "./context.ts";

export const NOT_STORED: unique symbol = Symbol("vault field not stored");

/** Opens one sealed field (bound to its row) for the duration of `use`, then zeroes it. */
export async function withItemSecret<T>(
  deps: { db: DbExecutor; keys: VaultDeps["keys"] },
  workspaceId: string,
  item: VaultItemRecord,
  field: VaultSecretField,
  use: (text: string) => Promise<T>,
): Promise<T | typeof NOT_STORED> {
  const sealed = await loadSealedSecret(deps.db, item.id, field);
  if (sealed === null) return NOT_STORED;
  return withOpenedText(
    deps.keys,
    sealed,
    { kind: "secret", workspaceId, alias: item.alias, origin: item.origin, field },
    use,
  );
}
