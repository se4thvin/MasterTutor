import { EventEmitter } from "node:events";
import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
import { createSecretFingerprints, isScannableSecret } from "./fingerprints.ts";
import { SECRET_REDACTION } from "./runtime.ts";

const fakeCdp = () => new EventEmitter() as unknown as CDPSession & EventEmitter;
const filled = (cdp: CDPSession, ids: number[], frameId = "main", loaderId = "doc-1") => ({
  cdp,
  frameId,
  loaderId,
  backendNodeIds: ids,
});

describe("secret fingerprints (the mask source B1 consumes)", () => {
  it("returns filled nodes per run and per CDP session", () => {
    const prints = createSecretFingerprints();
    const page = fakeCdp();
    const other = fakeCdp();
    prints.remember("run-a", { filled: filled(page, [7]), secret: null });
    expect(prints.forRun("run-a").nodeIds(page)).toEqual([7]);
    expect(prints.forRun("run-a").nodeIds(other)).toEqual([]);
    expect(prints.forRun("run-b").nodeIds(page)).toEqual([]);
  });

  it("redacts exact secret values in text, whatever surrounds them (R-E3)", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret: "MARMOT4CANARY8VELVET" });
    const mask = prints.forRun("run-a");
    expect(mask.hasSecrets()).toBe(true);
    expect(mask.redact("Your password is MARMOT4CANARY8VELVET.")).toBe(
      `Your password is ${SECRET_REDACTION}.`,
    );
    expect(mask.redact(JSON.stringify({ t: 'pw="MARMOT4CANARY8VELVET"' }))).not.toContain("MARMOT");
    expect(mask.redact("MARMOT4CANARY8VELVE and MARMOT4CANARY8VELVETS")).toBe(
      "MARMOT4CANARY8VELVE and MARMOT4CANARY8VELVETS",
    );
    expect(prints.forRun("run-b").redact("MARMOT4CANARY8VELVET")).toBe("MARMOT4CANARY8VELVET");
  });

  it("redacts a secret percent-encoded in a URL, and form-encoded with + for spaces (final review I2)", () => {
    const prints = createSecretFingerprints();
    const secret = "Kestrel#9!pass word";
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret });
    const mask = prints.forRun("run-a");
    for (const url of [
      `https://a.example/signin?p=${encodeURIComponent(secret)}`,
      "https://a.example/signin?p=Kestrel%239!pass%20word",
      `https://a.example/signin?${new URLSearchParams({ p: secret }).toString()}`,
      "https://a.example/signin?p=Kestrel%239%21pass+word&next=%2F",
    ])
      expect(mask.redact(url), url).toContain(SECRET_REDACTION);
    expect(mask.redact("https://a.example/signin?p=Kestrel%2399!pass")).not.toContain(
      SECRET_REDACTION,
    );
  });

  it("redacts a URL token whose decoded form holds the secret: strict, double, lowercase or partial encoding (final re-review I2)", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret: "Kestrel#9!pass word" });
    prints.remember("run-a", { filled: filled(fakeCdp(), [2]), secret: "Tiger/Lily:2024@x" });
    prints.remember("run-a", { filled: filled(fakeCdp(), [3]), secret: "Tiger*Lily_2024.x" });
    const mask = prints.forRun("run-a");
    for (const text of [
      "https://a.example/welcome?p=Kestrel%239%21pass%20word",
      "https://a.example/login?next=%2Fwelcome%3Fp%3DKestrel%25239%2521pass%2Bword",
      "https://a.example/cb?u=Tiger%2fLily%3a2024%40x&x=1",
      "https://a.example/cb?u=Tiger%2ALily_2024.x",
    ]) {
      const out = mask.redact(`Current page: ${text} (loaded)`);
      expect(out, text).toBe(`Current page: ${SECRET_REDACTION} (loaded)`);
    }
    // Unrelated encoded text and stray % signs stay as they are.
    for (const text of ["https://a.example/?q=Kestrel%2399pass%20word", "100% sure", "%E0%A4%A"])
      expect(mask.redact(text), text).toBe(text);
  });

  it("matches a secret with punctuation or spaces across any separators", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret: "p@ss-W0rd!" });
    prints.remember("run-a", { filled: filled(fakeCdp(), [2]), secret: "correct horse battery" });
    const mask = prints.forRun("run-a");
    expect(mask.redact("echo: p@ss-W0rd! done")).toBe(`echo: ${SECRET_REDACTION}! done`);
    expect(mask.redact("phrase: correct\nhorse   battery staple")).toBe(
      `phrase: ${SECRET_REDACTION} staple`,
    );
  });

  it("matches a symbol-only secret with spaces across any whitespace (review 14)", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret: "!! ##" });
    const mask = prints.forRun("run-a");
    expect(mask.redact("value: !! ## end")).toBe(`value: ${SECRET_REDACTION} end`);
    expect(mask.redact("value: !!\n  ## end")).toBe(`value: ${SECRET_REDACTION} end`);
    expect(mask.redact("value: !! #")).toBe("value: !! #");
  });

  it("matches a secret with no letters or digits as a whole token", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [1]), secret: "!@#$%^" });
    expect(prints.forRun("run-a").redact("value: !@#$%^ end")).toBe(
      `value: ${SECRET_REDACTION} end`,
    );
  });

  it("never registers usernames, one-time codes or short numbers as secret values", () => {
    const prints = createSecretFingerprints();
    prints.remember("run-a", { filled: filled(fakeCdp(), [3]), secret: null });
    prints.remember("run-a", { filled: filled(fakeCdp(), [4]), secret: "123" });
    expect(prints.forRun("run-a").hasSecrets()).toBe(false);
    expect([isScannableSecret("12"), isScannableSecret("123"), isScannableSecret("")]).toEqual([
      false,
      false,
      false,
    ]);
    expect([isScannableSecret("1234"), isScannableSecret("ab"), isScannableSecret("pw!")]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("forgets filled nodes when their document goes away, so the agent stays sighted (F8)", () => {
    const prints = createSecretFingerprints();
    const page = fakeCdp();
    prints.remember("run-a", {
      filled: filled(page, [1, 2], "main"),
      secret: "MARMOT4CANARY8VELVET",
    });
    prints.remember("run-a", { filled: filled(page, [9], "child"), secret: null });
    const mask = prints.forRun("run-a");
    page.emit("Page.frameNavigated", { frame: { id: "other-child", parentId: "main" } });
    expect(mask.nodeIds(page)).toEqual([1, 2, 9]);
    page.emit("Page.frameDetached", { frameId: "child" });
    expect(mask.nodeIds(page)).toEqual([1, 2]);
    page.emit("Page.frameNavigated", { frame: { id: "main" } });
    expect(mask.nodeIds(page)).toEqual([]);
    // The secret value stays registered for the run: a later page may still echo it.
    expect(mask.hasSecrets()).toBe(true);
  });

  it("forgets a finished run, including its CDP listeners", () => {
    const prints = createSecretFingerprints();
    const page = fakeCdp();
    prints.remember("run-a", { filled: filled(page, [1]), secret: "x".repeat(8) });
    expect(page.listenerCount("Page.frameNavigated")).toBe(1);
    prints.forgetRun("run-a");
    expect(prints.forRun("run-a").nodeIds(page)).toEqual([]);
    expect(prints.forRun("run-a").hasSecrets()).toBe(false);
    expect(page.listenerCount("Page.frameNavigated")).toBe(0);
    expect(page.listenerCount("Page.frameDetached")).toBe(0);
  });

  it("bounds memory per run", () => {
    const prints = createSecretFingerprints();
    const page = fakeCdp();
    for (let i = 0; i < 500; i++)
      prints.remember("run-a", { filled: filled(page, [i]), secret: null });
    const ids = prints.forRun("run-a").nodeIds(page);
    expect(ids.length).toBeLessThanOrEqual(200);
    expect(ids.at(-1)).toBe(499);
  });

  it("names the frames holding filled nodes by frame id, whatever session registered them (N2)", () => {
    const prints = createSecretFingerprints();
    const before = fakeCdp();
    prints.remember("run-a", { filled: filled(before, [5], "oopif-1"), secret: null });
    const mask = prints.forRun("run-a");
    // The frame's session was swapped (forgotten after a failed read): ids still find it.
    expect(mask.nodeIds(fakeCdp())).toEqual([]);
    expect(mask.filledFrames?.()).toEqual([{ frameId: "oopif-1", loaderId: "doc-1" }]);
    before.emit("Page.frameDetached", { frameId: "oopif-1" });
    expect(mask.filledFrames?.()).toEqual([]);
    expect(prints.forRun("run-b").filledFrames?.()).toEqual([]);
  });
});
