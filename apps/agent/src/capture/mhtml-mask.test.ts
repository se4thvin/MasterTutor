import { describe, expect, it } from "vitest";
import { createSecretFingerprints } from "../vault/fingerprints.ts";
import { MHTML_SKIP, maskMhtml, mhtmlTexts } from "./mhtml-mask.ts";
import type { CDPSession } from "playwright-core";
import { EventEmitter } from "node:events";

const SECRET = "MARMOT4CANARY8VELVET";
const sources = (secret = SECRET) => {
  const prints = createSecretFingerprints();
  const cdp = new EventEmitter() as unknown as CDPSession;
  prints.remember("run", {
    filled: { cdp, frameId: "main", loaderId: "doc", backendNodeIds: [1] },
    secret,
  });
  return prints.forRun("run");
};

/** Quoted-printable as Chrome writes it: `=` escapes, soft breaks at 76 columns. */
const qp = (text: string) => text.replace(/=/g, "=3D").replace(/(.{70})/g, "$1=\r\n");

const page = (html: string, css = "body { color: black }", location = "https://site.test/a") =>
  [
    "From: <Saved by Blink>",
    "Snapshot-Content-Location: https://site.test/a",
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; type="text/html"; boundary="----B"',
    "",
    "------B",
    "Content-Type: text/html",
    "Content-ID: <frame-1@mhtml.blink>",
    "Content-Transfer-Encoding: quoted-printable",
    `Content-Location: ${location}`,
    "",
    qp(html),
    "------B",
    "Content-Type: text/css",
    "Content-Transfer-Encoding: quoted-printable",
    "Content-Location: cid:css-1@mhtml.blink",
    "",
    qp(css),
    "------B--",
    "",
  ].join("\r\n");

/** Stand-in for the page-side rule: drops value="…" from password inputs. */
const strip = async (html: readonly string[]) =>
  html.map((doc) => doc.replace(/(<input[^>]*type="password"[^>]*?) value="[^"]*"/g, "$1"));

describe("maskMhtml (snapshot ruling)", () => {
  it("removes field values and redacts the secret everywhere, QP-decoded parts and headers too", async () => {
    const mhtml = page(
      `<html><body><input type="password" value="${SECRET}"><p data-x="${SECRET}">Hi</p>` +
        `<p>${"long paragraph text ".repeat(8)}</p></body></html>`,
      `.x::after { content: "${SECRET}" }`,
      `https://site.test/a?token=${SECRET}`,
    );
    expect(mhtmlTexts(mhtml).join("\n")).toContain(SECRET);
    const result = await maskMhtml(mhtml, sources(), strip);
    expect(result.kind).toBe("masked");
    const out = result.kind === "masked" ? result.mhtml : "";
    expect(out).not.toContain(SECRET);
    const texts = mhtmlTexts(out).join("\n");
    expect(texts).not.toContain(SECRET);
    expect(texts).toContain('<input type="password">');
    expect(texts).toContain("long paragraph text long paragraph text");
  });

  it("skips, with its reason, when a secret is still shown once markup is removed", async () => {
    const mhtml = page(`<html><body><p>Your key: MARMOT4<b>CANARY8</b>VELVET</p></body></html>`);
    expect(await maskMhtml(mhtml, sources(), strip)).toEqual({
      kind: "skipped",
      reason: MHTML_SKIP.secretRemains,
    });
  });

  it("redacts a generic secret without skipping: only distinctive secrets block storage", async () => {
    const mhtml = page(`<html><body><p>Even parity bits</p></body></html>`);
    const result = await maskMhtml(mhtml, sources("parity"), strip);
    expect(result.kind).toBe("masked");
    expect(mhtmlTexts(result.kind === "masked" ? result.mhtml : "").join("\n")).not.toMatch(
      /\bparity\b/,
    );
  });

  it("keeps an unchanged part byte for byte and refuses what it cannot parse", async () => {
    const mhtml = page("<html><body><p>Nothing secret here</p></body></html>");
    expect(await maskMhtml(mhtml, sources(), strip)).toEqual({ kind: "masked", mhtml });
    expect(await maskMhtml("not mime", sources(), strip)).toEqual({
      kind: "skipped",
      reason: MHTML_SKIP.unparsable,
    });
  });
});
