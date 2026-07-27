import type { AssetMimeType } from "@mastertutor/contracts";
import sharp from "sharp";

export interface ImageInfo {
  mime: string;
  width: number | null;
  height: number | null;
}

/** sharp formats we keep: only the stored-asset allow-list (TIFF, HEIF and the rest are not served). */
const FORMAT_MIME: Record<string, AssetMimeType> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** Sniffs the real format from the bytes; headers from the page are never trusted. Never call it on unsanitized SVG. */
export async function imageInfo(bytes: Uint8Array): Promise<ImageInfo | null> {
  try {
    const meta = await sharp(bytes, { animated: false, limitInputPixels: 268_402_689 }).metadata();
    const mime = meta.format ? FORMAT_MIME[meta.format] : undefined;
    return mime ? { mime, width: meta.width ?? null, height: meta.height ?? null } : null;
  } catch {
    return null;
  }
}

/** True when the bytes are SVG markup (after an optional BOM, XML prolog, comments or doctype). */
export function sniffSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 2_048))
    .replace(/^\uFEFF/, "")
    .trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>/]/i.test(head);
}

const NAMED: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  lpar: "(",
  rpar: ")",
  sol: "/",
  quot: '"',
  apos: "'",
  amp: "&",
  lt: "<",
  gt: ">",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

const UNSAFE_MARKUP = [
  /<\s*(script|foreignObject|style|animate|animateMotion|animateTransform|set|image|feImage|iframe|object|embed|handler|listener)\b/i,
  /<!DOCTYPE|<!ENTITY/i,
  /[\s/"']on[a-z]+\s*=/i,
  /@import|expression\s*\(|-moz-binding|behavior\s*:/i,
  // image-set() and src() fetch a string URL without any url( (re-review).
  /image-set\s*\(|\bsrc\s*\(/i,
  /url\((?!\s*["']?\s*#)/i,
  /\bhref\s*=(?!\s*["']?\s*#)/i,
  // A CSS escape (`\75 rl(`) decodes to `url(` in the browser: no backslash in any attribute value.
  /=\s*("[^"]*\\[^"]*"|'[^']*\\[^']*')/,
];

/**
 * Node-side second check on SVG the capture world already sanitized (preflight S2). Entities are
 * decoded first (twice, for double encoding), so `&#106;avascript:` cannot hide; only local `#id`
 * references survive. Exported SVGs open from disk without CSP, so this must be strict.
 */
export function isSafeSvg(svg: string): boolean {
  const decoded = decodeEntities(decodeEntities(svg));
  if (UNSAFE_MARKUP.some((pattern) => pattern.test(decoded))) return false;
  return !/javascript:|vbscript:|data:/i.test(decoded.replace(/[\s\0]/g, ""));
}
