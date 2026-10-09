import { containsSecret, type MaskSources } from "../browser/masking.ts";

/**
 * Masks an MHTML snapshot for a run that holds secrets or a page with secret fields (snapshot
 * ruling, superseding plan decisions 5 and 15):
 * 1. every password, OTP, PIN and vault-filled field loses its value (`stripFields`, run on the
 *    decoded HTML of each part by the caller's page-side rule);
 * 2. exact-match redaction (`MaskSources.redact`) runs over every decoded text part and every
 *    part's headers;
 * 3. if a distinctive secret still shows anywhere (also with markup and character references
 *    removed), nothing is stored and the reason is returned.
 */
export type MaskedMhtml = { kind: "masked"; mhtml: string } | { kind: "skipped"; reason: string };

export const MHTML_SKIP = {
  unparsable: "mhtml:unparsable",
  undecodable: "mhtml:undecodable_part",
  secretRemains: "mhtml:secret_remains",
} as const;

interface Part {
  headers: string;
  body: string;
}

const CRLF = "\r\n";

function header(headers: string, name: string): string | null {
  const match = new RegExp(`^${name}:[ \\t]*((?:.*)(?:\\r?\\n[ \\t].*)*)`, "im").exec(headers);
  return match ? match[1]!.replace(/\r?\n[ \t]+/g, " ").trim() : null;
}

/** The parts between `--boundary` lines; null when the document is not multipart. */
function split(mhtml: string): { head: string; boundary: string; parts: Part[] } | null {
  const headEnd = mhtml.search(/\r?\n\r?\n/);
  if (headEnd < 0) return null;
  const head = mhtml.slice(0, headEnd);
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(header(head, "Content-Type") ?? "")?.[1];
  if (!boundary) return null;
  const delimiter = `--${boundary}`;
  const chunks = mhtml.split(delimiter);
  const parts: Part[] = [];
  // chunks[0] is the preamble; the last chunk starts with "--" (the closing delimiter).
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith("--")) break;
    const body = chunk.replace(/^\r?\n/, "");
    const end = body.search(/\r?\n\r?\n/);
    if (end < 0) return null;
    const blank = /\r?\n\r?\n/.exec(body.slice(end))![0];
    parts.push({ headers: body.slice(0, end), body: body.slice(end + blank.length) });
  }
  return { head, boundary, parts };
}

/** Each part body keeps the line break that ends it, so an unchanged document joins back as it was. */
function join(head: string, boundary: string, parts: readonly Part[]): string {
  const body = parts.map((part) => `--${boundary}${CRLF}${part.headers}${CRLF}${CRLF}${part.body}`);
  return `${head}${CRLF}${CRLF}${body.join("")}--${boundary}--${CRLF}`;
}

function decodeQuotedPrintable(text: string): Uint8Array {
  const soft = text.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const char = soft[i]!;
    const hex = char === "=" ? soft.slice(i + 1, i + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(char));
    }
  }
  return Uint8Array.from(bytes);
}

/** RFC 2045 quoted-printable, CRLF line breaks kept, soft breaks under 76 columns. */
function encodeQuotedPrintable(bytes: Uint8Array): string {
  const lines: string[] = [];
  let line = "";
  const push = (piece: string) => {
    if (line.length + piece.length > 75) {
      lines.push(`${line}=`);
      line = "";
    }
    line += piece;
  };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === 0x0d && bytes[i + 1] === 0x0a) {
      lines.push(line);
      line = "";
      i++;
      continue;
    }
    const literal = (byte >= 33 && byte <= 126 && byte !== 61) || byte === 32 || byte === 9;
    const trailingSpace =
      (byte === 32 || byte === 9) && (bytes[i + 1] === 0x0d || i + 1 === bytes.length);
    push(
      literal && !trailingSpace
        ? String.fromCharCode(byte)
        : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    );
  }
  lines.push(line);
  return lines.join(CRLF);
}

interface Decoded {
  text: string;
  encode(text: string): string;
}

/** A text part's content and how to write it back; null for parts that are not text. */
function decodeText(part: Part): Decoded | null | "undecodable" {
  const type = (header(part.headers, "Content-Type") ?? "").toLowerCase();
  if (!/^(text\/|application\/(xhtml\+xml|xml|javascript|json)|image\/svg\+xml)/.test(type))
    return null;
  const charset = /charset="?([^";\s]+)/i.exec(type)?.[1] ?? "utf-8";
  if (!/^utf-?8$/i.test(charset)) return "undecodable";
  const encoding = (header(part.headers, "Content-Transfer-Encoding") ?? "7bit").toLowerCase();
  const utf8 = new TextDecoder("utf-8", { fatal: false });
  if (encoding === "quoted-printable")
    return {
      text: utf8.decode(decodeQuotedPrintable(part.body)),
      encode: (text) => encodeQuotedPrintable(new TextEncoder().encode(text)),
    };
  if (encoding === "base64")
    return {
      text: utf8.decode(Buffer.from(part.body.replace(/\s+/g, ""), "base64")),
      encode: (text) =>
        (
          Buffer.from(text, "utf8")
            .toString("base64")
            .match(/.{1,76}/g) ?? []
        ).join(CRLF),
    };
  if (/^(7bit|8bit|binary)$/.test(encoding)) return { text: part.body, encode: (text) => text };
  return "undecodable";
}

/** Rendered-looking text: markup removed and character references resolved, for the final check. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_m, name: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name.toLowerCase()]!,
    );
}

export async function maskMhtml(
  mhtml: string,
  sources: MaskSources,
  /** Each HTML document's source with secret-field values removed (same order). */
  stripFields: (html: readonly string[]) => Promise<string[]>,
): Promise<MaskedMhtml> {
  const parsed = split(mhtml);
  if (!parsed) return { kind: "skipped", reason: MHTML_SKIP.unparsable };
  const decoded = parsed.parts.map(decodeText);
  if (decoded.includes("undecodable")) return { kind: "skipped", reason: MHTML_SKIP.undecodable };
  const texts = decoded as Array<Decoded | null>;
  const htmlIndexes = parsed.parts
    .map((part, index) => ({ part, index }))
    .filter(
      ({ part, index }) =>
        texts[index] && /^text\/html/i.test(header(part.headers, "Content-Type") ?? ""),
    )
    .map(({ index }) => index);
  const stripped = await stripFields(htmlIndexes.map((index) => texts[index]!.text));
  const content = texts.map((text) => text?.text ?? null);
  htmlIndexes.forEach((index, i) => {
    content[index] = stripped[i] ?? content[index]!;
  });
  const shows = (text: string) =>
    sources.showsSecret ? sources.showsSecret(text) : containsSecret(sources, text);
  const parts: Part[] = [];
  const head = sources.redact(parsed.head);
  let changed = head !== parsed.head;
  for (const [index, part] of parsed.parts.entries()) {
    const headers = sources.redact(part.headers);
    changed ||= headers !== part.headers;
    const original = texts[index];
    if (!original) {
      parts.push({ headers, body: part.body });
      continue;
    }
    const redacted = sources.redact(content[index]!);
    if (shows(redacted) || shows(visibleText(redacted)))
      return { kind: "skipped", reason: MHTML_SKIP.secretRemains };
    if (redacted === original.text) {
      parts.push({ headers, body: part.body });
      continue;
    }
    changed = true;
    const ending = /\r?\n$/.exec(part.body)?.[0] ?? "";
    parts.push({ headers, body: `${original.encode(redacted.replace(/\r?\n$/, ""))}${ending}` });
  }
  const out = changed ? join(head, parsed.boundary, parts) : mhtml;
  if (shows(out)) return { kind: "skipped", reason: MHTML_SKIP.secretRemains };
  return { kind: "masked", mhtml: out };
}

/** Every text part's decoded content, headers included (for audits and tests). */
export function mhtmlTexts(mhtml: string): string[] {
  const parsed = split(mhtml);
  if (!parsed) return [mhtml];
  return [
    parsed.head,
    ...parsed.parts.flatMap((part) => {
      const decoded = decodeText(part);
      return [part.headers, decoded && decoded !== "undecodable" ? decoded.text : ""];
    }),
  ];
}
