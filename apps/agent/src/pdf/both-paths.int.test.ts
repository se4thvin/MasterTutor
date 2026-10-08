import { readFile } from "node:fs/promises";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AssetStore } from "../notes/assets.ts";
import { startTestPdfWorker } from "../testing/pdf-worker.ts";
import { testLog } from "../testing/tool-context.ts";
import { createDoclingClient } from "./docling.ts";
import { buildPdfCapture, type PdfCaptureDeps } from "./pdf-capture.ts";

const DOCLING_IMAGE =
  "quay.io/docling-project/docling-serve-cpu:v1.36.0@sha256:225c8586e20d5d0fc6811a9e0e044fa602bcc4393f00389009bad42d6787b58f";
const fixture = async () =>
  new Uint8Array(
    await readFile(new URL("../../../../tests/fixtures/sites/site/pdf/paper.pdf", import.meta.url)),
  );
const assets: AssetStore = {
  put: async (_ws, input) => ({
    assetId: crypto.randomUUID(),
    sha256: "x",
    mime: input.mime,
    bytes: input.bytes.length,
    width: input.width,
    height: input.height,
  }),
};
const deps = (docling: PdfCaptureDeps["docling"]): PdfCaptureDeps => ({
  assets,
  ocr: { transcribe: async () => "Scanned page text" },
  localOcr: { text: async () => "" },
  docling,
  pdf: worker.client,
  log: testLog,
});
const ctx = () => ({
  workspaceId: "w",
  signal: new AbortController().signal,
  step: new StepCollector(),
  mask: NO_MASK_SOURCES,
});

let docling: StartedTestContainer | undefined;
let worker: Awaited<ReturnType<typeof startTestPdfWorker>>;
beforeAll(async () => {
  worker = await startTestPdfWorker();
  docling = await new GenericContainer(DOCLING_IMAGE)
    .withEnvironment({
      DOCLING_SERVE_ENABLE_UI: "false",
      DOCLING_SERVE_ENABLE_REMOTE_SERVICES: "false",
    })
    .withExposedPorts(5001)
    .withWaitStrategy(Wait.forHttp("/health", 5001).forStatusCode(200))
    .withStartupTimeout(600_000)
    .start();
}, 900_000);
afterAll(async () => {
  await docling?.stop();
  await worker?.close();
});

describe("B5 done-when: the PDF fixture is verified on both paths", () => {
  it("pdf.js path", async () => {
    const capture = await buildPdfCapture(
      deps(null),
      ctx(),
      await fixture(),
      "https://x.test/paper.pdf",
    );
    expect(capture).toMatchObject({ engine: "pdfjs" });
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
  });
  it("docling path", async () => {
    const client = createDoclingClient(
      `http://${docling!.getHost()}:${docling!.getMappedPort(5001)}`,
    );
    const capture = await buildPdfCapture(
      deps(client),
      ctx(),
      await fixture(),
      "https://x.test/paper.pdf",
    );
    expect(capture.engine).toBe("docling");
    expect(capture.coverage).toBeGreaterThanOrEqual(0.98);
    expect(capture.blocks.some((b) => b.type === "heading" && b.anchor?.page === 1)).toBe(true);
    expect(
      capture.blocks.every(
        (b) => typeof b.anchor?.page === "number" && b.anchor.bbox !== undefined,
      ),
    ).toBe(true);
  }, 600_000);
});
