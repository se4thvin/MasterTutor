import { readFile } from "node:fs/promises";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeConfig } from "../../../../tests/compose/compose-json.ts";
import { NO_MASK_SOURCES } from "../browser/masking.ts";
import { StepCollector } from "../loop/step-collector.ts";
import type { AssetStore } from "../notes/assets.ts";
import { startTestPdfWorker } from "../testing/pdf-worker.ts";
import { testLog } from "../testing/tool-context.ts";
import { createDoclingClient } from "./docling.ts";
import { buildPdfCapture, type PdfCaptureDeps } from "./pdf-capture.ts";

/** docling exactly as compose.yml runs it (profile `pdf`): image pin and hardening (QA-107). */
const DOCLING = composeConfig(".env.test", ["compose.yml"], { profiles: ["pdf"] }).services
  .docling!;

/** testcontainers has no read-only root option; the service's own read_only is applied here. */
class ComposeHardened extends GenericContainer {
  readOnlyRoot(readOnly: boolean): this {
    this.hostConfig.ReadonlyRootfs = readOnly;
    return this;
  }
}
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
  expect(DOCLING).toMatchObject({ read_only: true, cap_drop: ["ALL"] });
  docling = await new ComposeHardened(DOCLING.image!)
    .readOnlyRoot(DOCLING.read_only === true)
    .withTmpFs(
      Object.fromEntries(
        (DOCLING.tmpfs ?? []).map((mount) => {
          const [path, ...options] = mount.split(":");
          return [path!, options.join(":")];
        }),
      ),
    )
    .withDroppedCapabilities(...(DOCLING.cap_drop ?? []))
    .withSecurityOpt(...(DOCLING.security_opt ?? []))
    .withEnvironment(
      Object.fromEntries(
        Object.entries(DOCLING.environment ?? {}).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      ),
    )
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
