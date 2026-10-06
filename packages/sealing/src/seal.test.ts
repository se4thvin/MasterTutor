import sodium from "libsodium-wrappers";
import { describe, expect, it, vi } from "vitest";
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

describe("pinned formats and vectors (review 3)", () => {
  it("derives the RFC 7748 §6.1 public key from Alice's private key", async () => {
    const alice = Buffer.from(
      "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
      "hex",
    ).toString("base64");
    const keys = await vaultKeyPairFromPrivate(alice);
    expect(Buffer.from(keys.publicKey).toString("hex")).toBe(
      "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
    );
  });

  it("still opens a box sealed by format version 1 (a stored row must stay readable)", async () => {
    const golden =
      "VgGV5jJknyWdUBcghyjL0I496bxWQwQmSfKEgabZgiFkHsT/peOcAXdDjjQ9kwJhgZd7TMvP6zCues0FidAmOLZb66NWyzihtXN00hi73/wWvMxi5vOvnBw8KkLeR2VjPsIG4prMEHmV4Wrh5nKY25H22d51MARl5uBU0ESoDhvP+h2+0R0HDSNEx4zs8RAEqlhfYfF3Hz6F2SyP8EHv03I9qRM=";
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const opened = await openSealed(keys, Buffer.from(golden, "base64"), secret);
    expect(new TextDecoder().decode(opened)).toBe("known-answer-42");
  });
});

describe("malformed envelopes (review 4)", () => {
  const sealRaw = async (plain: Uint8Array) => {
    await sodium.ready;
    return sodium.crypto_box_seal(plain, decodeVaultKey(TEST_PUBLIC));
  };
  const header = new TextEncoder().encode(encodeBinding(secret));

  it("refuses an unknown format version", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const plain = new Uint8Array([2, header.length >> 8, header.length & 0xff, ...header, 1]);
    await expect(openSealed(keys, await sealRaw(plain), secret)).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("refuses a header longer than the box", async () => {
    const keys = await vaultKeyPairFromPrivate(TEST_PRIVATE);
    const plain = new Uint8Array([1, 0xff, 0xff, ...header]);
    await expect(openSealed(keys, await sealRaw(plain), secret)).rejects.toMatchObject({
      code: "malformed",
    });
    await expect(
      openSealed(keys, await sealRaw(new Uint8Array([1, 0])), secret),
    ).rejects.toMatchObject({
      code: "malformed",
    });
  });
});

describe("key material is wiped (review 2)", () => {
  it("zeroes the buffer a key is decoded into", () => {
    const decoded: Buffer[] = [];
    const from = Buffer.from.bind(Buffer) as (value: unknown, encoding?: unknown) => Buffer;
    const spy = vi.spyOn(Buffer, "from").mockImplementation(((
      value: unknown,
      encoding?: unknown,
    ) => {
      const out = from(value, encoding);
      if (encoding === "base64") decoded.push(out);
      return out;
    }) as typeof Buffer.from);
    try {
      const key = decodeVaultKey(TEST_PRIVATE);
      expect(key.some((byte) => byte !== 0)).toBe(true);
      expect(decoded.length).toBeGreaterThan(0);
      for (const buffer of decoded) expect(buffer.every((byte) => byte === 0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("zeroes a generated private key once it is encoded", async () => {
    await sodium.ready;
    const pairs: Array<{ privateKey: Uint8Array }> = [];
    const original = sodium.crypto_box_keypair.bind(sodium);
    const spy = vi.spyOn(sodium, "crypto_box_keypair").mockImplementation(((...args: unknown[]) => {
      const pair = (original as (...a: unknown[]) => { privateKey: Uint8Array })(...args);
      pairs.push(pair);
      return pair;
    }) as typeof sodium.crypto_box_keypair);
    try {
      const generated = await generateVaultKeyPair();
      expect(generated.privateKeyBase64).toHaveLength(44);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]!.privateKey.every((byte) => byte === 0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
