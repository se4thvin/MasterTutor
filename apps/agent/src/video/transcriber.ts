import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { StatelessOpenAI } from "../llm/openai.ts";
import { transcriptionUsage } from "../llm/pricing.ts";
import type { StepWriter } from "../tools/types.ts";
import type { CaptionSegment } from "./json3.ts";

export interface Transcriber {
  /** Segments with times relative to the chunk. */
  transcribe(
    file: string,
    options: { signal: AbortSignal; step: StepWriter },
  ): Promise<CaptionSegment[]>;
}

/** gpt-4o-transcribe-diarize through the single factory: fields forced and typed there (D38; preflight D3). */
export function createTranscriber(openai: Pick<StatelessOpenAI, "audio">): Transcriber {
  return {
    async transcribe(file, { signal, step }) {
      const transcript = await openai.audio.transcriptions.create(
        { bytes: new Uint8Array(await readFile(file)), filename: basename(file) },
        { signal },
      );
      step.addUsage(transcriptionUsage(transcript.seconds));
      return transcript.segments.flatMap((s) => {
        const text = s.text.trim();
        return text
          ? [{ start: s.start, end: s.end, text, ...(s.speaker ? { speaker: s.speaker } : {}) }]
          : [];
      });
    },
  };
}
