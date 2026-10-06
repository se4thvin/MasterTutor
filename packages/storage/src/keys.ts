import { Uuid } from "@mastertutor/contracts";

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_FILENAME_BYTES = 200;
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

function uuid(value: string, what: string): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success) throw new TypeError(`${what} must be a UUID`);
  return parsed.data;
}
function count(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new TypeError(`${what} must be a non-negative integer`);
  return value;
}
function truncateUtf8(value: string, maxBytes: number): string {
  let out = "";
  for (const char of value) {
    if (byteLength(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}

/** One safe key segment from an untrusted name: basename only, letters/digits/._- and space, 200 bytes max. */
export function safeFilename(input: string): string {
  const base = input.normalize("NFKC").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^[.\s]+/, "")
    .replace(/\s+$/, "");
  if (cleaned.length === 0) return "download";
  if (byteLength(cleaned) <= MAX_FILENAME_BYTES) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  const stem = extension ? cleaned.slice(0, dot) : cleaned;
  const kept = truncateUtf8(stem, MAX_FILENAME_BYTES - byteLength(extension)) + extension;
  return kept.length > 0 ? kept : "download";
}

export function isObjectKey(key: string): boolean {
  return (
    key.length > 0 &&
    byteLength(key) <= 1024 &&
    !key.startsWith("/") &&
    !/\p{Cc}/u.test(key) &&
    !key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

export const SNAPSHOT_NAMES = ["page.mhtml", "page.png"] as const;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[number];

/** The only place object keys are built (spec §7, §10.2). */
export const objectKeys = {
  asset(workspaceId: string, sha256: string): string {
    if (!SHA256_RE.test(sha256)) throw new TypeError("sha256 must be 64 lowercase hex chars");
    return `assets/${uuid(workspaceId, "workspaceId")}/${sha256}`;
  },
  snapshot(sourceId: string, name: SnapshotName): string {
    if (!SNAPSHOT_NAMES.includes(name)) throw new TypeError("unknown snapshot name");
    return `snapshots/${uuid(sourceId, "sourceId")}/${name}`;
  },
  /** `nonce` makes the key unique per capture so a stale worker can never overwrite a live one's image. */
  stepScreenshot(runId: string, seq: number, nonce: string): string {
    if (!/^[a-z0-9]{1,32}$/.test(nonce))
      throw new TypeError("nonce must be 1-32 lowercase alphanumerics");
    return `runs/${uuid(runId, "runId")}/steps/${count(seq, "seq")}-${nonce}.png`;
  },
  stepScreenshotPrefix(runId: string): string {
    return `runs/${uuid(runId, "runId")}/steps/`;
  },
  transcriptImagePrefix(runId: string): string {
    return `runs/${uuid(runId, "runId")}/transcript/`;
  },
  /** `nonce` makes the key unique per commit so a zombie writer can never overwrite a live owner's image. */
  transcriptImage(runId: string, seq: number, index: number, nonce?: string, ext = "png"): string {
    if (!/^[a-z0-9]{1,8}$/.test(ext))
      throw new TypeError("ext must be 1-8 lowercase alphanumerics");
    if (nonce !== undefined && !/^[a-z0-9]{1,32}$/.test(nonce))
      throw new TypeError("nonce must be 1-32 lowercase alphanumerics");
    return `runs/${uuid(runId, "runId")}/transcript/${count(seq, "seq")}-${count(index, "index")}${nonce ? `-${nonce}` : ""}.${ext}`;
  },
  download(runId: string, filename: string): string {
    return `downloads/${uuid(runId, "runId")}/${safeFilename(filename)}`;
  },
} as const;
