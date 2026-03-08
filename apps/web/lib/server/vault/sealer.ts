import { decodeVaultKey, sealValue, type SealBinding } from "@mastertutor/sealing";
import { getWebEnv } from "../env.ts";

/** web seals with the public key only (spec §3.1, §9). It can never open what it seals. */
export interface Sealer {
  seal(binding: SealBinding, value: string): Promise<Uint8Array>;
}

export function createSealer(publicKeyBase64: string): Sealer {
  const publicKey = decodeVaultKey(publicKeyBase64);
  return { seal: (binding, value) => sealValue(publicKey, binding, value) };
}

let cached: Sealer | undefined;

export function getSealer(): Sealer {
  cached ??= createSealer(getWebEnv().VAULT_PUBLIC_KEY);
  return cached;
}
