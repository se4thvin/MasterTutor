import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_IMAGE_PIXELS,
  MAX_PAGE_ITEMS,
  MAX_PDF_PAGES,
  MAX_PDF_RENDERS,
  MAX_RENDER_PIXELS,
  MAX_TEXT_CHARS,
  WORKER_TIMEOUT_MS,
  type AnalyzeOptions,
} from "../protocol.ts";
import { ChildResult, encodeChildRequest } from "./protocol.ts";

/** The child's stdout: items and renders before layout (bounded by the item and render caps). */
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024 * 1024;

const require = createRequire(import.meta.url);
const WORKER = fileURLToPath(new URL("./main.ts", import.meta.url));
/** apps/agent: the worker's own code and package.json (Node reads it for the module type). */
const AGENT_ROOT = resolve(dirname(WORKER), "../../..");

/** A package's own directory, symlinks resolved (pnpm links into node_modules/.pnpm). */
function packageDir(pkg: string, from: NodeJS.Require = require): string {
  return dirname(realpathSync(from.resolve(`${pkg}/package.json`)));
}

/**
 * The node_modules directory holding a package: under pnpm, that package's own store entry with
 * only it and links to its declared dependencies (resolution has to look there).
 */
function storeEntry(dir: string): string {
  const marker = `${sep}node_modules${sep}`;
  const at = dir.lastIndexOf(marker);
  return at < 0 ? dir : dir.slice(0, at + marker.length - 1);
}

/**
 * Exactly the packages the worker loads: pdf.js, the canvas binding, its one installed native
 * binary (whichever optional platform package resolves here) and zod for the wire schema.
 */
function workerPackageDirs(): string[] {
  const canvas = packageDir("@napi-rs/canvas");
  const fromCanvas = createRequire(`${canvas}${sep}package.json`);
  const manifest = fromCanvas(`${canvas}${sep}package.json`) as {
    optionalDependencies?: Record<string, string>;
  };
  const platforms = Object.keys(manifest.optionalDependencies ?? {}).flatMap((name) => {
    try {
      return [packageDir(name, fromCanvas)];
    } catch {
      return [];
    }
  });
  return [packageDir("pdfjs-dist"), canvas, ...platforms, packageDir("zod")].map(storeEntry);
}

/** Read library code only; no writes, no child processes, no workers, no eval; bounded memory (S3). */
export function workerFlags(): string[] {
  const roots = new Set([AGENT_ROOT, ...workerPackageDirs()]);
  return [
    "--permission",
    ...[...roots].map((root) => `--allow-fs-read=${root}`),
    "--allow-addons",
    "--disallow-code-generation-from-strings",
    "--max-old-space-size=512",
  ];
}

/** The child crashed, timed out, wrote too much or wrote something off-schema. */
export class SandboxFailed extends Error {
  constructor() {
    super("pdf sandbox failed");
    this.name = "SandboxFailed";
  }
}

/**
 * Parses and renders one PDF in a child Node with an empty environment under the permission model
 * (preflight S3), killed on abort, at `timeoutMs` (I-2) or on oversized output. Its output is
 * schema-checked. Runs only inside the pdf-worker container (B5 review I-1).
 */
export async function runInSandbox(
  options: AnalyzeOptions,
  pdf: Uint8Array,
  signal: AbortSignal,
  timeoutMs: number = WORKER_TIMEOUT_MS,
): Promise<ChildResult> {
  signal.throwIfAborted();
  const request = {
    ...options,
    maxPages: MAX_PDF_PAGES,
    maxRenders: MAX_PDF_RENDERS,
    maxPixels: MAX_RENDER_PIXELS,
    maxImagePixels: MAX_IMAGE_PIXELS,
    maxPageItems: MAX_PAGE_ITEMS,
    maxTextChars: MAX_TEXT_CHARS,
  };
  const child = spawn(process.execPath, [...workerFlags(), WORKER], {
    env: {},
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const kill = () => void child.kill("SIGKILL");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  deadline.addEventListener("abort", kill, { once: true });
  child.stdin.on("error", () => undefined);
  try {
    child.stdin.end(encodeChildRequest(request, pdf));
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of child.stdout) {
      total += (chunk as Buffer).length;
      if (total > MAX_CHILD_OUTPUT_BYTES) throw new SandboxFailed();
      chunks.push(chunk as Buffer);
    }
    const code = await exited;
    signal.throwIfAborted();
    if (code !== 0 || deadline.aborted) throw new SandboxFailed();
    let json: unknown;
    try {
      json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new SandboxFailed();
    }
    const parsed = ChildResult.safeParse(json);
    if (!parsed.success) throw new SandboxFailed();
    return parsed.data;
  } finally {
    deadline.removeEventListener("abort", kill);
    if (child.exitCode === null && child.signalCode === null) kill();
  }
}
