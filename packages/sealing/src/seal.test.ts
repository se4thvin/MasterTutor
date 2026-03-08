import { describe, expect, it } from "vitest";
import {
  MAX_SEALED_VALUE_BYTES,
  SealError,
  decodeVaultKey,
  encodeBinding,
  sealValue,
  type SealBinding,
} from "./index.ts";
import * as webEntry from "./index.ts";
import {
  generateVaultKeyPair,
  openSealed,
  vaultKeyPairFromPrivate,
  withOpenedText,
} from "./open.ts";

// The dummy pair from .env.test (Phase 0). It protects nothing.
const TEST_PUBLIC = "y5DgMx35MF/R/d3MSLtIufXczYHJAqVtEIEMLY/Qf3M=";
const TEST_PRIVATE = "kCNZsvnP2oSO4FaU/yZoEi4TCPUK/EKw1zn4wI/5s1c=";
const ws = "6f1c1f43-2a8e-4d0b-9a59-0c7c1b0f2a11";
const otherWs = "0b8f5d2e-77aa-4c1e-8f00-3c2d1e0f9a88";
const secret = {
  kind: "secret",
  workspaceId: ws,
  alias: "zybooks",
  origin: "https://learn.zybooks.com",
  field: "password",
} as const satisfies SealBinding;

describe("vault keys", () => {
  it("derives the .env.test public key from its private key", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    expect(Buffer.from(keys.publicKey).toString("base64")).toBe(TEST_PUBLIC);
  });

  it("rejects keys that are not exactly 32 canonical base64 bytes", () => {
    expect(() => decodeVaultKey("AAAA")).toThrow(SealError);
    expect(() => decodeVaultKey(Buffer.alloc(33).toString("base64"))).toThrow(SealError);
    expect(() => decodeVaultKey(`${TEST_PUBLIC} `)).toThrow(SealError);
  });

  it("generates fresh, consistent pairs", async () => {
    const a = await generateVaultKeyPair();
    const b = await generateVaultKeyPair();
    expect(a.privateKeyBase64).not.toBe(b.privateKeyBase64);
    const derived = await vaultKeyPairFromPrivate(a.privateKeyBase64);
    expect(derived.publicKey).toEqual(decodeVaultKey(a.publicKeyBase64));
  });
});

describe("sealValue / openSealed", () => {
  it("round-trips a value bound to its row", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const sealed = await sealValue(decodeVaultKey(TEST_PUBLIC), secret, "hunter2-CANARY");
    const opened = await openSealed(keys, sealed, secret);
    expect(new TextDecoder().decode(opened)).toBe("hunter2-CANARY");
  });

  it("refuses to open a box under any other binding", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const sealed = await sealValue(keys.publicKey, secret, "hunter2-CANARY");
    const others: SealBinding[] = [
      { ...secret, workspaceId: otherWs },
      { ...secret, alias: "zybook" },
      { ...secret, origin: "https://learn.zybooks.co" },
      { ...secret, field: "username" },
      { kind: "session", workspaceId: ws, alias: "zybooks", origin: secret.origin },
      { kind: "otp", workspaceId: ws, runId: otherWs },
    ];
    for (const binding of others) {
      await expect(openSealed(keys, sealed, binding)).rejects.toMatchObject({
        code: "binding_mismatch",
      });
    }
  });

  it("never contains the plaintext and is randomized per seal", async () => {
    const pub = decodeVaultKey(TEST_PUBLIC);
    const a = await sealValue(pub, secret, "hunter2-CANARY");
    const b = await sealValue(pub, secret, "hunter2-CANARY");
    expect(Buffer.from(a).includes(Buffer.from("hunter2-CANARY"))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("fails closed on the wrong key and on tampering", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const sealed = await sealValue(keys.publicKey, secret, "x");
    const stranger = await vaultKeyPairFromPrivate((await generateVaultKeyPair()).privateKeyBase64);
    await expect(openSealed(stranger, sealed, secret)).rejects.toMatchObject({
      code: "cannot_open",
    });
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(openSealed(keys, tampered, secret)).rejects.toMatchObject({ code: "cannot_open" });
  });

  it("caps value size", async () => {
    const big = new Uint8Array(MAX_SEALED_VALUE_BYTES + 1);
    await expect(sealValue(decodeVaultKey(TEST_PUBLIC), secret, big)).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("withOpenedText hands the text to the callback and returns its result", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const sealed = await sealValue(keys.publicKey, secret, "élan-42");
    expect(await withOpenedText(keys, sealed, secret, async (text) => text.length)).toBe(7);
  });

  it("encodes bindings canonically, independent of property order", () => {
    const reordered = {
      field: "password",
      origin: secret.origin,
      alias: "zybooks",
      workspaceId: ws,
      kind: "secret",
    } as const;
    expect(encodeBinding(reordered)).toBe(encodeBinding(secret));
  });

  it("the web entry exposes no way to open a box", () => {
    expect(Object.keys(webEntry).filter((name) => /open|private/i.test(name))).toEqual([]);
  });
});
