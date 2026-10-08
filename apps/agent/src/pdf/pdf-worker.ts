import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalyzeResult,
  encodeRequest,
  type AnalyzeRequest,
  type PdfPageText,
} from "./worker/protocol.ts";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export const MAX_PDF_RENDERS = 40;
/** US Letter at scale 2 (1224×1584) fits; larger pages are scaled down. */
export const MAX_RENDER_PIXELS = 4_000_000;
export const WORKER_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const require = createRequire(import.meta.url);
const WORKER = fileURLToPath(new URL("./worker/main.ts", import.meta.url));
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

export interface PdfRender {
  page: number;
  scale: number;
  png: Uint8Array;
}
export interface PdfAnalysis {
  title: string | null;
  pages: PdfPageText[];
  renders: PdfRender[];
}

export type PdfWorkerErrorCode = "not_pdf" | "too_large" | "parse_failed" | "worker_failed";
export class PdfWorkerError extends Error {
  readonly code: PdfWorkerErrorCode;
  constructor(code: PdfWorkerErrorCode) {
    super(`pdf worker: ${code}`);
    this.name = "PdfWorkerError";
    this.code = code;
  }
}

/**
 * Parses and renders a PDF outside the agent process (preflight S3; decision 16): a child Node with
 * an empty environment (no vault key, database or OpenAI credentials) under the permission model,
 * killed on abort, timeout or oversized output. Its output is schema-checked.
 */
export async function analyzePdf(
  bytes: Uint8Array,
  options: { render: "auto" | number[]; scale: number },
  signal: AbortSignal,
): Promise<PdfAnalysis> {
  signal.throwIfAborted();
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfWorkerError("too_large");
  const request: AnalyzeRequest = {
    render: options.render,
    scale: options.scale,
    maxPages: MAX_PDF_PAGES,
    maxRenders: MAX_PDF_RENDERS,
    maxPixels: MAX_RENDER_PIXELS,
  };
  const child = spawn(process.execPath, [...workerFlags(), WORKER], {
    env: {},
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
  const kill = () => void child.kill("SIGKILL");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(WORKER_TIMEOUT_MS)]);
  deadline.addEventListener("abort", kill, { once: true });
  child.stdin.on("error", () => undefined);
  try {
    child.stdin.end(encodeRequest(request, bytes));
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of child.stdout) {
      total += (chunk as Buffer).length;
      if (total > MAX_OUTPUT_BYTES) {
        kill();
        throw new PdfWorkerError("worker_failed");
      }
      chunks.push(chunk as Buffer);
    }
    const code = await exited;
    signal.throwIfAborted();
    if (code !== 0) throw new PdfWorkerError("worker_failed");
    const parsed = AnalyzeResult.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) throw new PdfWorkerError("worker_failed");
    const result = parsed.data;
    if (!result.ok) throw new PdfWorkerError(result.error);
    return {
      title: result.title,
      pages: result.pages,
      renders: result.renders.map((r) => ({
        page: r.page,
        scale: r.scale,
        png: new Uint8Array(Buffer.from(r.png, "base64")),
      })),
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new PdfWorkerError("worker_failed");
    throw error;
  } finally {
    deadline.removeEventListener("abort", kill);
    if (child.exitCode === null && child.signalCode === null) kill();
  }
}
