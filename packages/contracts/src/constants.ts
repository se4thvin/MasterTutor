import { z } from "zod";
import { SLOT_NAME_PATTERN, SlotName } from "./primitives.ts";

/** Verified against /v1/models on 2026-10-05 (D1, D31). */
export const MODELS = {
  agentPrimary: "gpt-6-astra",
  agentFallback: "gpt-6.1-sol",
  filing: "gpt-6-luna",
  /**
   * The run title: one short structured answer per run. gpt-6-luna is the smallest model on our
   * key (D1: the cheap high-volume one) and already proven on strict JSON (filing).
   */
  runTitle: "gpt-6-luna",
  transcription: "gpt-4o-transcribe-diarize",
  embeddings: "text-embedding-3-small",
} as const;

export const EMBEDDING_DIMENSIONS = 1536;
export const VIEWPORT = { width: 1280, height: 800 } as const;
/**
 * Bytes one live-view upload may carry, all files together (spec §10.2.8). The client refuses
 * more; Traefik's live upload route enforces the same limit (maxRequestBodyBytes, A14).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Downloads a person may keep in one run, across its leases (B1's gate cancels the rest). */
export const MAX_USER_DOWNLOADS_PER_RUN = 20;
/** Bytes one such download may have (B1's gate cancels it as it grows past this, spec §10.2.9). */
export const MAX_USER_DOWNLOAD_BYTES = 200 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 6;
export const NOTIFY_MAX_BYTES = 200;

/** The single size cap for stored assets (fetches, screenshots, PDFs, keyframes). */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
/** Content types an asset may be stored as: the web app serves them as these types. */
export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
  "application/pdf",
] as const;
export type AssetMimeType = (typeof ASSET_MIME_TYPES)[number];
export function isAssetMimeType(mime: string): mime is AssetMimeType {
  return (ASSET_MIME_TYPES as readonly string[]).includes(mime);
}

export const CDP_LOCAL_PORT = 9222;
export const CDP_PROXY_PORT = 9223;
export const NEKO_PORT = 8080;
export const PULSE_TCP_PORT = 4713;
/** Slot X-idle probe (xprintidle over socat); agent IP only. */
export const SLOT_IDLE_PORT = 9224;
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
