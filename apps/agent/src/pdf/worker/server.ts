/**
 * The pdf-worker service (B5 review I-1): the only place PDFs are parsed. It runs in its own
 * container on the internal `pdf` network, with no secrets, no egress and a read-only root. Each PDF
 * is parsed by a `node --permission` child (sandbox.ts); layout runs here, off the agent.
 *
 *   POST /analyze   body: protocol.ts encodeRequest   →   200 JSON PdfAnswer
 *   GET  /healthz
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import {
  decodeRequest,
  MAX_PDF_BYTES,
  MAX_RESULT_BYTES,
  WORKER_TIMEOUT_MS,
  type AnalyzeOptions,
  type PdfAnswer,
} from "../protocol.ts";
import { pdfBlocks, pdfReferenceText } from "./layout.ts";
import { createLimiter, LimiterFull } from "./limiter.ts";
import { runInSandbox, SandboxFailed } from "./sandbox.ts";

export const PDF_WORKER_PORT = 5002;
/** Concurrent PDFs per container (I-2); a few more may wait, the rest are told the worker is busy. */
export const PDF_WORKER_CONCURRENCY = 2;
const QUEUE = 4;
const MAX_BODY_BYTES = MAX_PDF_BYTES + 64 * 1024;

/** One PDF: parsed in the sandbox, then laid out into blocks. */
export async function analyzeDocument(
  options: AnalyzeOptions,
  pdf: Uint8Array,
  signal: AbortSignal,
  timeoutMs: number = WORKER_TIMEOUT_MS,
): Promise<PdfAnswer> {
  let child;
  try {
    child = await runInSandbox(options, pdf, signal, timeoutMs);
  } catch (error) {
    if (error instanceof SandboxFailed) return { ok: false, error: "worker_failed" };
    throw error;
  }
  if (!child.ok) return child;
  return {
    ok: true,
    title: child.title,
    pages: child.pages.map(({ items, ...page }) => ({ ...page, hasText: items.length > 0 })),
    reference: pdfReferenceText(child.pages),
    blocks: pdfBlocks(child.pages).map(({ type, markdown, page, bbox }) => ({
      type,
      markdown,
      page,
      bbox,
    })),
    renders: child.renders,
  };
}

async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createPdfWorkerServer(
  options: { concurrency?: number; timeoutMs?: number } = {},
): Server {
  const limiter = createLimiter(options.concurrency ?? PDF_WORKER_CONCURRENCY, QUEUE);
  return createServer(async (request, response) => {
    const send = (status: number, body: PdfAnswer | { ok: true }) => {
      const json = JSON.stringify(body);
      // The agent checks the size too; this keeps an oversized answer from leaving at all.
      if (Buffer.byteLength(json) > MAX_RESULT_BYTES)
        return send(200, { ok: false, error: "too_large" });
      response.writeHead(status, { "content-type": "application/json" }).end(json);
    };
    if (request.method === "GET" && request.url === "/healthz") return send(200, { ok: true });
    if (request.method !== "POST" || request.url !== "/analyze") {
      response.writeHead(404).end();
      return;
    }
    // A caller that goes away frees its slot and kills its child.
    const gone = new AbortController();
    response.once("close", () => gone.abort());
    try {
      const body = await readBody(request);
      if (!body) return send(413, { ok: false, error: "too_large" });
      const decoded = decodeRequest(body);
      if (!decoded) return send(400, { ok: false, error: "parse_failed" });
      const free = await limiter.acquire(gone.signal);
      try {
        send(
          200,
          await analyzeDocument(decoded.options, decoded.pdf, gone.signal, options.timeoutMs),
        );
      } finally {
        free();
      }
    } catch (error) {
      if (gone.signal.aborted) return;
      if (error instanceof LimiterFull) return send(503, { ok: false, error: "busy" });
      send(500, { ok: false, error: "worker_failed" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createPdfWorkerServer();
  server.listen(PDF_WORKER_PORT, "0.0.0.0");
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
