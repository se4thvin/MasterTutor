import { describe, expect, it } from "vitest";
import { expectAbsent } from "./canary.ts";

const CANARY = { password: "OSPREY6CANARY2LANTERN" };

describe("expectAbsent", () => {
  it("finds a canary as is, as hex and inside base64 at any byte alignment", () => {
    const hex = Buffer.from(CANARY.password).toString("hex");
    for (const leak of [CANARY.password, hex, hex.toUpperCase()])
      expect(() => expectAbsent(`x ${leak} y`, "t", CANARY)).toThrow();
    for (const prefix of ["", "a", "ab", "abc"]) {
      const blob = Buffer.from(`${prefix}${CANARY.password}!`);
      expect(() => expectAbsent(blob.toString("base64"), "t", CANARY), prefix).toThrow();
      expect(() => expectAbsent(blob.toString("base64url"), "t", CANARY), prefix).toThrow();
    }
  });

  it("passes text that holds no canary", () => {
    expect(() => expectAbsent("Signed in. Password: [secret]", "t", CANARY)).not.toThrow();
  });
});
