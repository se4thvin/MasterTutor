import { vaultKeyPairFromPrivate, type VaultKeyPair } from "@mastertutor/sealing/open";

type PrivateKeyNames = "VAULT_PRIVATE_KEY" | "VAULT_NEXT_PRIVATE_KEY";

/**
 * S2: unwraps the vault key pair, then removes the private keys from both process.env and the
 * parsed env, so after boot they live in the key pair only.
 */
export async function takeVaultKeys<E extends { VAULT_PRIVATE_KEY: string }>(
  parsed: E,
  processEnv: NodeJS.ProcessEnv,
): Promise<{ keys: VaultKeyPair; env: Omit<E, PrivateKeyNames> }> {
  const keys = await vaultKeyPairFromPrivate(parsed.VAULT_PRIVATE_KEY);
  delete processEnv["VAULT_PRIVATE_KEY"];
  delete processEnv["VAULT_NEXT_PRIVATE_KEY"];
  const {
    VAULT_PRIVATE_KEY: _private,
    VAULT_NEXT_PRIVATE_KEY: _next,
    ...env
  } = parsed as E & { VAULT_NEXT_PRIVATE_KEY?: string };
  return { keys, env };
}
