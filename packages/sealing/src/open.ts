// Agent-only entry (spec §3.1: web can seal but never decrypt). A security test enforces this.
import { encodeBinding, type SealBinding } from "./binding.ts";
import { SEAL_VERSION, SealError, decodeVaultKey } from "./seal.ts";
import { getSodium } from "./sodium.ts";

export interface VaultKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export async function vaultKeyPairFromPrivate(privateKeyBase64: string): Promise<VaultKeyPair> {
  const sodium = await getSodium();
  const privateKey = decodeVaultKey(privateKeyBase64);
  return { privateKey, publicKey: sodium.crypto_scalarmult_base(privateKey) };
}

/** For tests and key rotation. Callers must never log the private half. */
export async function generateVaultKeyPair(): Promise<{
  publicKeyBase64: string;
  privateKeyBase64: string;
}> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return {
    publicKeyBase64: Buffer.from(pair.publicKey).toString("base64"),
    privateKeyBase64: Buffer.from(pair.privateKey).toString("base64"),
  };
}

/** Opens a box and checks its binding. The caller must wipe() the returned bytes. */
export async function openSealed(
  keys: VaultKeyPair,
  sealed: Uint8Array,
  expected: SealBinding,
): Promise<Uint8Array> {
  const sodium = await getSodium();
  let plain: Uint8Array;
  try {
    plain = sodium.crypto_box_seal_open(sealed, keys.publicKey, keys.privateKey);
  } catch {
    throw new SealError("cannot_open");
  }
  try {
    if (plain.length < 3 || plain[0] !== SEAL_VERSION) throw new SealError("malformed");
    const headerLength = ((plain[1] ?? 0) << 8) | (plain[2] ?? 0);
    if (3 + headerLength > plain.length) throw new SealError("malformed");
    const header = new TextDecoder().decode(plain.subarray(3, 3 + headerLength));
    if (header !== encodeBinding(expected)) throw new SealError("binding_mismatch");
    return plain.slice(3 + headerLength);
  } finally {
    sodium.memzero(plain);
  }
}

/** Opens, hands the text to `use`, then zeroes the decrypted bytes. Keep the string local. */
export async function withOpenedText<T>(
  keys: VaultKeyPair,
  sealed: Uint8Array,
  expected: SealBinding,
  use: (text: string) => Promise<T>,
): Promise<T> {
  const sodium = await getSodium();
  const value = await openSealed(keys, sealed, expected);
  try {
    return await use(new TextDecoder().decode(value));
  } finally {
    sodium.memzero(value);
  }
}
