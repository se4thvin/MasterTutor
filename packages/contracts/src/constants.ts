import { z } from "zod";
import { SLOT_NAME_PATTERN, SlotName } from "./primitives.ts";

/** Verified against /v1/models on 2026-10-05 (D1, D31). */
export const MODELS = {
  agentPrimary: "gpt-6-astra",
  agentFallback: "gpt-6.1-sol",
  filing: "gpt-6-luna",
  transcription: "gpt-4o-transcribe-diarize",
  embeddings: "text-embedding-3-small",
} as const;

export const EMBEDDING_DIMENSIONS = 1536;
export const VIEWPORT = { width: 1280, height: 800 } as const;
export const DEFAULT_CONCURRENCY = 6;
export const NOTIFY_MAX_BYTES = 200;

export const CDP_LOCAL_PORT = 9222;
export const CDP_PROXY_PORT = 9223;
export const NEKO_PORT = 8080;
export const PULSE_TCP_PORT = 4713;
export const MEDIA_PORT_BASE = 59000;

export function mediaPortForSlot(slot: string): number {
  if (!SLOT_NAME_PATTERN.test(slot)) throw new TypeError(`Invalid slot name: ${slot}`);
  return MEDIA_PORT_BASE + Number(slot.slice("browser-".length));
}

/** The default always-on slot set; BROWSER_SLOTS overrides it (comma-separated). */
export const DEFAULT_BROWSER_SLOTS = [
  "browser-1",
  "browser-2",
  "browser-3",
  "browser-4",
  "browser-5",
  "browser-6",
] as const;

/** Comma-separated slot names ("browser-1,browser-2") parsed to a unique, non-empty list. */
export const SlotList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(
    z
      .array(SlotName)
      .min(1, "List at least one slot")
      .refine((names) => new Set(names).size === names.length, "Slot names must be unique"),
  );

export function parseBrowserSlots(csv: string): string[] {
  return SlotList.parse(csv);
}
