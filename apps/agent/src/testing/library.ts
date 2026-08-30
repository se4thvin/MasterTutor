import { fakeEmbeddingsClient } from "@mastertutor/contracts/testing";
import type { Database } from "@mastertutor/db";
import type { LibraryServices } from "../library.ts";
import { createAssetStore } from "../notes/assets.ts";
import { createEmbedder } from "../notes/embedder.ts";
import { NoteWriter } from "../notes/note-writer.ts";
import { createMemoryStorage } from "./memory-storage.ts";
import { testLog } from "./tool-context.ts";

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

/** The one place tests build LibraryServices: real writer and asset store, fake models, memory storage. */
export function fakeLibraryServices(
  db: Database,
  overrides: Partial<LibraryServices> = {},
): LibraryServices & { ocrCalls: number[]; storage: MemoryStorage } {
  const storage = createMemoryStorage();
  const ocrCalls: number[] = [];
  return {
    db,
    writer: new NoteWriter({ db, embedder: createEmbedder(fakeEmbeddingsClient(), testLog) }),
    assets: createAssetStore({ db, storage }),
    ocr: {
      async transcribe(png) {
        ocrCalls.push(png.byteLength);
        return "Quarterly results\n\nRevenue rose 12 percent on strong demand.";
      },
    },
    localOcr: { text: async () => "", words: async () => [] },
    filing: { decide: async () => ({ path: ["Inbox"], createLeaf: true }) },
    transcriber: {
      transcribe: async () => [{ start: 0, end: 3, text: "Welcome to the lecture.", speaker: "A" }],
    },
    audioCapture: {
      start: async () => {
        throw new Error("this test has no audio-capture service");
      },
    },
    docling: null,
    pdf: {
      analyze: async () => {
        throw new Error("this test has no pdf worker (testing/pdf-worker.ts starts one)");
      },
    },
    log: testLog,
    ...overrides,
    storage,
    ocrCalls,
  };
}
