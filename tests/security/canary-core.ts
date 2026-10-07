/**
 * Secret-canary matching (spec §12 security test 1), one source for B3's in-process vault tests
 * and the post-E2E stack scan. Pure: no test framework, no I/O. Never puts a value in a message.
 */
export type Canaries = Readonly<Record<string, string>>;
export type CanaryForm = "plain" | "hex" | "base64" | "utf16" | "ocr";
export interface CanaryHit {
  canary: string;
  where: string;
  form: CanaryForm;
}

const DIGITS = /^[0-9]+$/;
/** Shorter values have no base64 core that a neighbouring byte cannot change (P7-34). */
const MIN_BASE64_BYTES = 12;
/** Long enough that a fuzzy OCR match cannot be a coincidence. */
const MIN_FUZZY_LENGTH = 12;

function entries(canaries: Canaries): [string, string][] {
  const list = Object.entries(canaries);
  for (const [name, value] of list)
    if (value.length === 0) throw new TypeError(`canary ${name} is empty`);
  return list;
}

const wholeNumber = (digits: string) => new RegExp(`(?<![0-9])${digits}(?![0-9])`);

/** base64 and base64url characters a leaked value always produces, at each of the 3 alignments. */
function base64Cores(bytes: Buffer): string[] {
  if (bytes.length < MIN_BASE64_BYTES) return [];
  const cores: string[] = [];
  for (let shift = 0; shift < 3; shift++) {
    const text = Buffer.concat([Buffer.alloc(shift), bytes]).toString("base64");
    const core = text.slice(Math.ceil((shift * 4) / 3), text.length - 4);
    cores.push(core, core.replaceAll("+", "-").replaceAll("/", "_"));
  }
  return cores;
}

/**
 * Every canary in `haystack` (text, or bytes decoded as latin1). Text canaries match as is, as hex
 * in any case, inside base64 or base64url, and as UTF-16LE. Digit-only canaries (PINs, codes)
 * match only as a whole number.
 */
export function findCanaryHits(haystack: string, where: string, canaries: Canaries): CanaryHit[] {
  const hits: CanaryHit[] = [];
  const lower = haystack.toLowerCase();
  for (const [canary, value] of entries(canaries)) {
    if (DIGITS.test(value)) {
      if (wholeNumber(value).test(haystack)) hits.push({ canary, where, form: "plain" });
      continue;
    }
    const bytes = Buffer.from(value, "utf8");
    let form: CanaryForm | null = null;
    if (haystack.includes(value)) form = "plain";
    else if (lower.includes(bytes.toString("hex"))) form = "hex";
    else if (base64Cores(bytes).some((core) => haystack.includes(core))) form = "base64";
    else if (haystack.includes(Buffer.from(value, "utf16le").toString("latin1"))) form = "utf16";
    if (form) hits.push({ canary, where, form });
  }
  return hits;
}

export const describeHit = (hit: CanaryHit): string =>
  `${hit.canary} (${hit.form}) in ${hit.where}`;

/** Throws naming each canary, form and place found: B3's §12 assertion. */
export function expectAbsent(haystack: string, where: string, canaries: Canaries): void {
  const hits = findCanaryHits(haystack, where, canaries);
  if (hits.length > 0) throw new Error(hits.map(describeHit).join("; "));
}

/** Characters OCR confuses, folded to one form on both sides of a comparison. */
const CONFUSABLE: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  "|": "1",
  Z: "2",
  S: "5",
  B: "8",
  G: "6",
  T: "7",
};

function fold(text: string): string {
  return Array.from(
    text.toUpperCase().replace(/[^A-Z0-9|]/g, ""),
    (char) => CONFUSABLE[char] ?? char,
  ).join("");
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** True when OCR text contains the canary up to confusable characters and 2 edits. */
export function ocrContains(ocrText: string, canary: string): boolean {
  const hay = fold(ocrText);
  const needle = fold(canary);
  if (hay.includes(needle)) return true;
  for (let i = 0; i + needle.length - 2 <= hay.length; i++) {
    if (distance(hay.slice(i, i + needle.length), needle) <= 2) return true;
  }
  return false;
}

/** OCR text: fuzzy for long text canaries, exact for short ones, whole numbers for digits. */
export function findOcrHits(ocrText: string, where: string, canaries: Canaries): CanaryHit[] {
  const hits: CanaryHit[] = [];
  for (const [canary, value] of entries(canaries)) {
    const seen = DIGITS.test(value)
      ? wholeNumber(value).test(ocrText)
      : value.length >= MIN_FUZZY_LENGTH
        ? ocrContains(ocrText, value)
        : ocrText.includes(value);
    if (seen) hits.push({ canary, where, form: "ocr" });
  }
  return hits;
}
