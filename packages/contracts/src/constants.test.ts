import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_SLOTS,
  MODELS,
  VIEWPORT,
  mediaPortForSlot,
  parseBrowserSlots,
} from "./constants.ts";

describe("constants", () => {
  it("pins the verified model IDs", () => {
    expect(MODELS).toEqual({
      agentPrimary: "gpt-6-astra",
      agentFallback: "gpt-6.1-sol",
      filing: "gpt-6-luna",
      runTitle: "gpt-6-luna",
      observerGuardScreen: "gpt-6-luna",
      observerGuardReview: "gpt-6.1-sol",
      observerCopilot: "gpt-6.1-sol",
      transcription: "gpt-4o-transcribe-diarize",
      embeddings: "text-embedding-3-small",
    });
    expect(VIEWPORT).toEqual({ width: 1280, height: 800 });
  });

  it("maps slots to their media port", () => {
    expect(mediaPortForSlot("browser-1")).toBe(59001);
    expect(mediaPortForSlot("browser-6")).toBe(59006);
    expect(() => mediaPortForSlot("browser-x")).toThrow();
  });

  it("parses the slot list", () => {
    expect(DEFAULT_BROWSER_SLOTS).toHaveLength(6);
    expect(parseBrowserSlots("browser-1, browser-2")).toEqual(["browser-1", "browser-2"]);
    expect(() => parseBrowserSlots("")).toThrow();
    expect(() => parseBrowserSlots("browser-1,nope")).toThrow();
  });
});
