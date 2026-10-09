import { createECDH } from "node:crypto";

/** A VAPID key pair as env values: base64url uncompressed P-256 point and 32-byte scalar (RFC 8292). */
export function vapidKeyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // A scalar with leading zero bytes comes back short; the env shape is always 32 bytes.
  const scalar = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(scalar, 32 - raw.length);
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: scalar.toString("base64url"),
  };
}

export function vapidPairMatches(publicKey: string, privateKey: string): boolean {
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateKey, "base64url"));
    return ecdh.getPublicKey().toString("base64url") === publicKey;
  } catch {
    return false;
  }
}
