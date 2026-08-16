/**
 * The pdf.js child (preflight S3, defence in depth). Started only by sandbox.ts inside the pdf-worker
 * container, under `node --permission` with an empty environment: it reads one request from stdin
 * and writes one JSON result to stdout.
 */
import { analyze } from "./pdfjs.ts";
import { decodeChildRequest, type ChildResult } from "./protocol.ts";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
let result: ChildResult;
try {
  const { request, pdf } = decodeChildRequest(Buffer.concat(chunks));
  result = await analyze(request, pdf);
} catch {
  result = { ok: false, error: "parse_failed" };
}
process.stdout.write(JSON.stringify(result));
