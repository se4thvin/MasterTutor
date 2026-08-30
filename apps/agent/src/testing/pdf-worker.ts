import type { AddressInfo } from "node:net";
import { createPdfWorkerClient, type PdfAnalyzer } from "../pdf/pdf-worker.ts";
import { createPdfWorkerServer } from "../pdf/worker/server.ts";

/** The pdf-worker service in the test process (sandboxed children and all), on a loopback port. */
export async function startTestPdfWorker(
  options: Parameters<typeof createPdfWorkerServer>[0] = {},
): Promise<{ url: string; client: PdfAnalyzer; close(): Promise<void> }> {
  const server = createPdfWorkerServer(options);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    client: createPdfWorkerClient(url),
    close: () => new Promise((done) => server.close(() => done())),
  };
}
