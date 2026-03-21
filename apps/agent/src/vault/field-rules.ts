import type { CredentialField } from "@mastertutor/contracts";
import type { TargetInfo } from "./dom.ts";

const USERNAME_HINT = /user|e-?mail|login|account|identifier|phone/;
const OTP_HINT = /otp|one[- ]?time|verification|2fa|mfa|passcode|security code|\bcode\b|token/;
const NUMERIC_TYPES = new Set(["tel", "number"]);

/**
 * Spec §9 check 3: the target must look like the field being filled. Attributes come from the
 * vault's isolated world, so page scripts cannot fake them through DOM prototypes.
 */
export function fieldAccepts(field: CredentialField, target: TargetInfo): boolean {
  if (target.tag !== "input" || !target.visible || !target.editable) return false;
  const autocomplete = new Set(target.autocomplete);
  const numeric = target.inputMode === "numeric" || NUMERIC_TYPES.has(target.type);
  switch (field) {
    case "password":
      return (
        target.type === "password" ||
        (target.type === "text" &&
          (autocomplete.has("current-password") || autocomplete.has("new-password")))
      );
    case "username":
      if (target.type === "password") return false;
      return (
        target.type === "email" ||
        autocomplete.has("username") ||
        autocomplete.has("email") ||
        ((target.type === "text" || target.type === "tel") &&
          (target.hasPasswordInScope || USERNAME_HINT.test(target.hints)))
      );
    case "totp":
    case "otp":
      return (
        autocomplete.has("one-time-code") ||
        numeric ||
        ((target.type === "text" || target.type === "password") && OTP_HINT.test(target.hints))
      );
    case "pin":
      return target.type === "password" || numeric;
  }
}
