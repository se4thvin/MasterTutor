import { encodeBinding, type SealBinding } from "./binding.ts";
import { getSodium } from "./sodium.ts";

export const SEAL_VERSION = 1;
/** Sessions (cookies + localStorage) are the largest values; secrets are tiny. */
export const MAX_SEALED_VALUE_BYTES = 2 * 1024 * 1024;
export const VAULT_KEY_BYTES = 32;

export type SealErrorCode =
  "malformed" | "cannot_open" | "binding_mismatch" | "too_large" | "bad_key";

/** Carries only a code, never key material or plaintext. */
export class SealError extends Error {
  readonly code: SealErrorCode;
  constructor(code: SealErrorCode) {
    super(`Sealing failed: ${code}`);
    this.name = "SealError";
    this.code = code;
  }
}

/** Decodes VAULT_PUBLIC_KEY / VAULT_PRIVATE_KEY (standard base64 of 32 raw X25519 bytes). */
export function decodeVaultKey(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== VAULT_KEY_BYTES || bytes.toString("base64") !== base64) {
    throw new SealError("bad_key");
  }
  return new Uint8Array(bytes);
}

/** Zeroes a buffer that held plaintext (spec §9: sodium.memzero after use). */
export async function wipe(bytes: Uint8Array): Promise<void> {
  (await getSodium()).memzero(bytes);
}

/**
 * Seals `value` for the vault key pair. The plaintext is
 * [version][u16 header length][canonical binding JSON][value]; it is zeroed before returning.
 */
export async function sealValue(
  publicKey: Uint8Array,
  binding: SealBinding,
  value: string | Uint8Array,
): Promise<Uint8Array> {
  if (publicKey.length !== VAULT_KEY_BYTES) throw new SealError("bad_key");
  const sodium = await getSodium();
  const header = new TextEncoder().encode(encodeBinding(binding));
  const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
  try {
    if (body.length > MAX_SEALED_VALUE_BYTES) throw new SealError("too_large");
    if (header.length > 0xffff) throw new SealError("malformed");
    const plain = new Uint8Array(3 + header.length + body.length);
    plain[0] = SEAL_VERSION;
    plain[1] = header.length >> 8;
    plain[2] = header.length & 0xff;
    plain.set(header, 3);
    plain.set(body, 3 + header.length);
    try {
      return sodium.crypto_box_seal(plain, publicKey);
    } finally {
      sodium.memzero(plain);
    }
  } finally {
    if (typeof value === "string") sodium.memzero(body);
  }
}
