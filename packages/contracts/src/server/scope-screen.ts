import { createHmac } from "node:crypto";

/** Purpose-bound authentication: the screen endpoint never accepts an Observer bearer. */
export function scopeScreenToken(internalToken: string): string {
  return createHmac("sha256", internalToken)
    .update("mastertutor:capture-scope-screen:v1")
    .digest("base64url");
}
