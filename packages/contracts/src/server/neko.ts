import { createHmac } from "node:crypto";
import { SlotName } from "../primitives.ts";

/** Same derivation as apps/browser-slot/bin/slot-entrypoint (openssl dgst -sha256 -hmac). */
export function deriveNekoPassword(secret: string, slotName: string): string {
  const slot = SlotName.parse(slotName);
  if (secret.length < 32) throw new RangeError("n.eko secrets must be at least 32 characters");
  return createHmac("sha256", secret).update(slot).digest("hex");
}
