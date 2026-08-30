import type { Database } from "@mastertutor/db";
import type { Storage } from "@mastertutor/storage";
import { createAnnotateTool } from "./capture/annotate-tool.ts";
import { createCaptureTool } from "./capture/capture-tool.ts";
import { sharedLocalOcr, type LocalOcr } from "./browser/local-ocr.ts";
import { createOcrModel, type OcrModel } from "./capture/opaque.ts";
import type { StatelessOpenAI } from "./llm/openai.ts";
import type { RunHooks } from "./loop/hooks.ts";
import { createAssetStore, type AssetStore } from "./notes/assets.ts";
import { createEmbedder } from "./notes/embedder.ts";
import { createFilingModel, fileRunNote, type FilingModel } from "./notes/filing.ts";
import { NoteWriter } from "./notes/note-writer.ts";
import { createDoclingClient, type DoclingClient } from "./pdf/docling.ts";
import { createPdfWorkerClient, type PdfAnalyzer } from "./pdf/pdf-worker.ts";
import type { Log } from "./runtime/types.ts";
import { register } from "./tools/types.ts";
import { isTimedtextUrl } from "./video/captions.ts";
import { createTranscriber, type Transcriber } from "./video/transcriber.ts";
import { createVideoTool } from "./video/video-tool.ts";

export interface LibraryDeps {
  db: Database;
  storage: Storage;
  openai: StatelessOpenAI;
  /** docling-serve on the internal `pdf` network (profile `pdf`); null keeps the pdf.js path. */
  doclingUrl?: string | null;
  /** The pdf-worker service (internal `pdf` network): PDFs are parsed there, never here. */
  pdfWorkerUrl: string;
  log: Log;
}

/** Everything capture, annotate, video, PDF and filing need; built once per agent process. */
export interface LibraryServices {
  db: Database;
  writer: NoteWriter;
  assets: AssetStore;
  storage: Storage;
  ocr: OcrModel;
  /** Self-hosted OCR that screens pixels for vault secrets before storage or OpenAI (A-M1). */
  localOcr: LocalOcr;
  filing: FilingModel;
  /** Video audio → diarized text through the single OpenAI factory (D38). */
  transcriber: Transcriber;
  /** docling-serve (profile `pdf`), or null for the pdf.js path. */
  docling: DoclingClient | null;
  /** The pdf-worker service (B5 review I-1). */
  pdf: PdfAnalyzer;
  log: Log;
}

export function createLibraryServices(deps: LibraryDeps): LibraryServices {
  return {
    db: deps.db,
    writer: new NoteWriter({ db: deps.db, embedder: createEmbedder(deps.openai, deps.log) }),
    assets: createAssetStore({ db: deps.db, storage: deps.storage }),
    storage: deps.storage,
    ocr: createOcrModel(deps.openai),
    localOcr: sharedLocalOcr(),
    filing: createFilingModel(deps.openai),
    transcriber: createTranscriber(deps.openai),
    docling: deps.doclingUrl ? createDoclingClient(deps.doclingUrl) : null,
    pdf: createPdfWorkerClient(deps.pdfWorkerUrl),
    log: deps.log,
  };
}

/** What B2/B4/B5 plug into the run loop, merged with B3 and B6 through composeRunHooks. */
export function libraryHooks(services: LibraryServices): Partial<RunHooks> {
  return {
    functionTools: [
      register(createCaptureTool(services)),
      register(createAnnotateTool(services)),
      register(createVideoTool(services)),
    ],
    // Caption tracks the player fetched stay readable for the video tool (preflight Q5).
    responseLog: isTimedtextUrl,
    async onComplete({ run, log, step }) {
      try {
        await fileRunNote(services, { runId: run.id, workspaceId: run.workspaceId }, step);
      } catch (error) {
        log.warn(
          { runId: run.id, errName: (error as Error).name },
          "filing failed; note left unfiled",
        );
      }
      return { ok: true };
    },
  };
}
