/**
 * The pdf.js worker (preflight S3). Started only by pdf-worker.ts under `node --permission` with an
 * empty environment: it reads one request from stdin and writes one JSON result to stdout.
 */
import { analyze } from "./pdfjs.ts";
import { decodeRequest, type AnalyzeResult } from "./protocol.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
let result: AnalyzeResult;
try {
  const { request, pdf } = decodeRequest(Buffer.concat(chunks));
  result = await analyze(request, pdf);
} catch {
  result = { ok: false, error: "parse_failed" };
}
process.stdout.write(JSON.stringify(result));
