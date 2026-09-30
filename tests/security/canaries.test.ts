import { readFileSync } from "node:fs";
import { parseTotpSeed } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { GREENMAIL_USER } from "../fixtures/vault-sites/greenmail.ts";
import { STACK_CANARIES } from "./canaries.ts";

describe("stack secret canaries (Task 1's single source, X6)", () => {
  it("are distinct, and text canaries are long enough to find inside base64 (P7-34)", () => {
    const values = Object.values(STACK_CANARIES);
    expect(new Set(values).size).toBe(values.length);
    for (const [name, value] of Object.entries(STACK_CANARIES)) {
      if (/^[0-9]+$/.test(value)) expect(value, name).toMatch(/^[0-9]{6}$/);
      else expect(Buffer.byteLength(value), name).toBeGreaterThanOrEqual(12);
    }
  });

  it("hold a TOTP key the vault accepts and reuse greenmail's mailbox password (X6)", () => {
    expect(parseTotpSeed(STACK_CANARIES.totpSeed)).not.toBeNull();
    expect(STACK_CANARIES.imapPassword).toBe(GREENMAIL_USER.password);
    expect(STACK_CANARIES.otp).toMatch(/^[0-9]{6}$/);
  });

  it("are served by the vault-fixtures bin, the only fixture that knows them (P7-39)", () => {
    const bin = readFileSync(new URL("../fixtures/vault-sites/bin.ts", import.meta.url), "utf8");
    expect(bin).toContain("password: STACK_CANARIES.password");
    expect(bin).toContain("fixedOtp: STACK_CANARIES.otp");
  });
});
