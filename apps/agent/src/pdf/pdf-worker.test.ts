import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createPdfWorkerClient } from "./pdf-worker.ts";
import { MAX_RESULT_BYTES } from "./protocol.ts";

/** A stand-in pdf-worker answering with `handler`; the client under test talks to it over HTTP. */
async function withStub<T>(handler: RequestListener, run: (url: string) => Promise<T>): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
const json =
  (body: unknown, status = 200): RequestListener =>
  (request, response) => {
    request.resume();
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
const pdf = new TextEncoder().encode("%PDF-1.7");
const live = () => new AbortController().signal;
const call = (url: string, options: { timeoutMs?: number } = {}) =>
  createPdfWorkerClient(url, options).analyze(pdf, { render: "auto", scale: 2 }, live());

describe("createPdfWorkerClient (the agent's side of the pdf-worker contract)", () => {
  it("decodes a valid answer", async () => {
    const answer = {
      ok: true,
      title: "T",
      pages: [{ page: 1, width: 612, height: 792, hasImages: false, hasText: true }],
      reference: "hello",
      blocks: [
        {
          type: "paragraph",
          markdown: "hello",
          page: 1,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
      truncated: false,
      renders: [{ page: 1, scale: 1, png: Buffer.from("png").toString("base64") }],
    };
    const out = await withStub(json(answer), (url) => call(url));
    expect(out).toMatchObject({ title: "T", reference: "hello", truncated: false });
    expect(out.renders[0]!.png).toEqual(new TextEncoder().encode("png"));
  });
  it("refuses an off-schema answer", async () => {
    await expect(withStub(json({ ok: true, title: 1 }), (url) => call(url))).rejects.toMatchObject({
      code: "worker_failed",
    });
    await expect(
      withStub(
        (_q, r) => r.end("not json"),
        (url) => call(url),
      ),
    ).rejects.toMatchObject({ code: "worker_failed" });
  });
  it("stops reading an answer over MAX_RESULT_BYTES", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const huge: RequestListener = (request, response) => {
      request.resume();
      response.writeHead(200);
      let sent = 0;
      const pump = () => {
        while (sent <= MAX_RESULT_BYTES) {
          sent += chunk.length;
          if (!response.write(chunk)) return void response.once("drain", pump);
        }
        response.end();
      };
      pump();
    };
    await expect(withStub(huge, (url) => call(url))).rejects.toMatchObject({
      code: "worker_failed",
    });
  });
  it("maps the worker's own refusals, busy included", async () => {
    await expect(
      withStub(json({ ok: false, error: "not_pdf" }), (url) => call(url)),
    ).rejects.toMatchObject({ code: "not_pdf" });
    await expect(
      withStub(json({ ok: false, error: "busy" }, 503), (url) => call(url)),
    ).rejects.toMatchObject({ code: "worker_failed" });
  });
  it("reports a worker that is down or hung, without hanging the agent", async () => {
    // Nothing listens on port 9 here: connection refused.
    await expect(call("http://127.0.0.1:9")).rejects.toMatchObject({ code: "worker_failed" });
    const hung: RequestListener = (request) => void request.resume();
    const started = performance.now();
    await expect(withStub(hung, (url) => call(url, { timeoutMs: 300 }))).rejects.toMatchObject({
      code: "worker_failed",
    });
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
