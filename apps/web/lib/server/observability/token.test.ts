import { describe, expect, it } from "vitest";
import { observabilityKey, signObservabilityToken, verifyObservabilityToken } from "./token.ts";

const key = observabilityKey("test-better-auth-secret-0123456789abcdef");
const NOW = 1_800_000_000;
const claim = { purpose: "session", userId: "user_abc", expiresAt: NOW + 60 } as const;

describe("observability hand-off ticket and obs-host session (D50 ruling I-2)", () => {
  it("verifies its own token for its purpose, before it expires", () => {
    const token = signObservabilityToken(key, claim);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(verifyObservabilityToken(key, "session", token, NOW)).toBe("user_abc");
  });

  it("refuses another purpose, an expired, tampered or foreign token", () => {
    const token = signObservabilityToken(key, claim);
    expect(verifyObservabilityToken(key, "ticket", token, NOW)).toBeNull();
    expect(verifyObservabilityToken(key, "session", token, NOW + 60)).toBeNull();
    expect(verifyObservabilityToken(key, "session", `${token.slice(0, -2)}xx`, NOW)).toBeNull();
    const forged = signObservabilityToken(
      observabilityKey("another-secret-0123456789abcdefgh"),
      claim,
    );
    expect(verifyObservabilityToken(key, "session", forged, NOW)).toBeNull();
    const longer = signObservabilityToken(key, { ...claim, expiresAt: NOW + 3_600 });
    expect(
      verifyObservabilityToken(
        key,
        "session",
        longer.replace(String(NOW + 3_600), String(NOW + 9_999)),
        NOW,
      ),
    ).toBeNull();
    for (const junk of ["", "a.b.c", "session..1.x", "x".repeat(600)])
      expect(verifyObservabilityToken(key, "session", junk, NOW)).toBeNull();
  });

  it("derives a key of its own from the app secret", () => {
    expect(observabilityKey("s".repeat(40))).not.toEqual(Buffer.from("s".repeat(40)));
    expect(observabilityKey("s".repeat(40))).toHaveLength(32);
  });
});
