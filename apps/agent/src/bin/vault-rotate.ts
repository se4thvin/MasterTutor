/**
 * vault:rotate (spec §9). Re-seals every vault row from the current key pair to the next one.
 *
 *   0. Turn the kill switch on (Settings) or stop the agent service: until the redeploy, the
 *      running agent's old key cannot open rotated rows, so fills fail closed (S2).
 *   1. Generate the next pair, for example with `pnpm env:init` in a scratch checkout, and keep it
 *      out of shell history (export it from a 0600 file).
 *   2. VAULT_PRIVATE_KEY=<current> VAULT_NEXT_PRIVATE_KEY=<next> \
 *        docker compose run --rm -e VAULT_PRIVATE_KEY -e VAULT_NEXT_PRIVATE_KEY agent \
 *        node apps/agent/src/bin/vault-rotate.ts
 *   3. Set web VAULT_PUBLIC_KEY to the printed nextPublicKey and agent VAULT_PRIVATE_KEY to <next>; redeploy.
 *   4. Run step 2 again with the same two keys: it re-seals anything web sealed in between.
 *   5. Turn the kill switch off.
 * It prints counts and the next PUBLIC key only.
 */
import { VaultRotateEnv, parseEnv } from "@mastertutor/contracts";
import { createDb } from "@mastertutor/db";
import { vaultKeyPairFromPrivate } from "@mastertutor/sealing/open";
import { rotateVaultKeys } from "../vault/rotate.ts";

const env = parseEnv(VaultRotateEnv, process.env);
const from = await vaultKeyPairFromPrivate(env.VAULT_PRIVATE_KEY);
const to = await vaultKeyPairFromPrivate(env.VAULT_NEXT_PRIVATE_KEY);
const handle = createDb(env.DATABASE_URL, { max: 1 });
try {
  const report = await rotateVaultKeys(handle.sql, from, to);
  process.stdout.write(
    `${JSON.stringify({ ...report, nextPublicKey: Buffer.from(to.publicKey).toString("base64") })}\n`,
  );
} finally {
  await handle.close();
}
