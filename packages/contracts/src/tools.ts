import { z } from "zod";
import { CredentialField, Fidelity, VideoOp, type ToolProfile } from "./enums.ts";
import { Alias, ElementRef, Sha256Hex, Uuid } from "./primitives.ts";
import { TOOL_NAMES, type ToolName } from "./tool-call.ts";

export const FUNCTION_TOOL_NAMES = [
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
] as const satisfies readonly ToolName[];
export type FunctionToolName = (typeof FUNCTION_TOOL_NAMES)[number];

/**
 * The tools the model receives per profile (Phase 10). computer_use is screenshots plus the computer
 * tool, with only the vault's credential tools beside it, so no DOM text reaches the model.
 */
export const TOOL_PROFILE_TOOLS = {
  browser_use: TOOL_NAMES,
  computer_use: ["computer", "fill_credential", "use_passkey"],
} as const satisfies Record<ToolProfile, readonly ToolName[]>;

export function isToolInProfile(profile: ToolProfile, tool: ToolName): boolean {
  return (TOOL_PROFILE_TOOLS[profile] as readonly ToolName[]).includes(tool);
}

export const ComputerResult = z.object({ screenshotKey: z.string().min(1).max(1024) });
export type ComputerResult = z.infer<typeof ComputerResult>;

/** D20: the compact element view keeps only these attributes. */
export const READ_PAGE_ATTRS = [
  "aria-label",
  "role",
  "alt",
  "title",
  "href",
  "name",
  "type",
  "data-label",
] as const;
export const ReadPageAttr = z.enum(READ_PAGE_ATTRS);
export type ReadPageAttr = z.infer<typeof ReadPageAttr>;
/** Most elements one interactive read_page result lists; a longer page is read with `offset`. */
export const READ_PAGE_MAX_ELEMENTS = 400;
export const ReadPageArgs = z.object({
  mode: z.enum(["interactive", "text"]),
  sinceHash: Sha256Hex.nullable(),
  /** Interactive mode: list elements in document order from this index (paging past the cap). */
  offset: z.number().int().min(0).max(100_000).nullable(),
});
export type ReadPageArgs = z.infer<typeof ReadPageArgs>;
export const ReadPageElement = z.object({
  ref: ElementRef,
  tag: z.string().min(1).max(32),
  role: z.string().max(64).nullable(),
  name: z.string().max(500),
  attrs: z.partialRecord(ReadPageAttr, z.string().max(2_000)),
  /** Click target in screenshot pixels; null when off-screen or covered (B1 amendment). */
  point: z.object({ x: z.number().int().min(0), y: z.number().int().min(0) }).nullable(),
});
export type ReadPageElement = z.infer<typeof ReadPageElement>;
/** D20: tools may answer {unchanged: true} instead of re-emitting large state. */
export const Unchanged = z.object({ unchanged: z.literal(true) });
const PageHeader = { hash: Sha256Hex, url: z.url(), title: z.string().max(1_000) };
export const ReadPageResult = z.union([
  Unchanged,
  z.object({
    ...PageHeader,
    elements: z.array(ReadPageElement).max(2_000),
    /** How many elements the page listed before the cap; more than `elements` means truncated. */
    total: z.number().int().nonnegative().optional(),
    /** Set when the call paged: `elements` are the document-order slice from this index. */
    offset: z.number().int().nonnegative().optional(),
  }),
  z.object({ ...PageHeader, text: z.string().max(200_000) }),
]);
export type ReadPageResult = z.infer<typeof ReadPageResult>;

export const CAPTURE_SCOPES = ["page", "selection", "element"] as const;
export const CaptureArgs = z
  .object({
    scope: z.enum(CAPTURE_SCOPES),
    selector: z.string().min(1).max(2_000).nullable(),
    kind: z.enum(["web", "pdf"]).nullable(),
  })
  .superRefine((args, ctx) => {
    if (args.scope === "element" && args.selector === null) {
      ctx.addIssue({
        code: "custom",
        path: ["selector"],
        message: "element scope needs a selector",
      });
    }
  });
export type CaptureArgs = z.infer<typeof CaptureArgs>;
export const CaptureResult = z.object({
  noteId: Uuid.nullable(),
  kept: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  blockIds: z.array(Uuid),
  coverage: z.number().min(0).max(1),
  fidelity: Fidelity,
});
export type CaptureResult = z.infer<typeof CaptureResult>;

export const ToolOk = z.object({ ok: z.literal(true) });
export type ToolOk = z.infer<typeof ToolOk>;

export const CREDENTIAL_ERROR_CODES = [
  "unknown_alias",
  "origin_mismatch",
  "frame_mismatch",
  "field_type_mismatch",
  "approval_required",
  "otp_unavailable",
  "field_not_stored",
  /** Only a person can approve this use (a form that posts off-origin, in auto mode). */
  "needs_human",
  /** fill_credential {target: "focused"} found no focused field in the main frame. */
  "no_focused_field",
  "fill_failed",
] as const;
export const CredentialErrorCode = z.enum(CREDENTIAL_ERROR_CODES);
export type CredentialErrorCode = z.infer<typeof CredentialErrorCode>;
export const FOCUSED_TARGET = "focused";
/** A read_page element ref, or "focused": the main-frame element with keyboard focus (pixel-only runs). */
export const CredentialTarget = z
  .string()
  .regex(/^(?:e[0-9]{1,6}|focused)$/, "Expected an element ref like e12, or focused");
export type CredentialTarget = z.infer<typeof CredentialTarget>;
export const FillCredentialArgs = z.object({
  alias: Alias,
  field: CredentialField,
  target: CredentialTarget,
});
export type FillCredentialArgs = z.infer<typeof FillCredentialArgs>;
export const FillCredentialResult = z.union([ToolOk, z.object({ error: CredentialErrorCode })]);
export type FillCredentialResult = z.infer<typeof FillCredentialResult>;

export const PASSKEY_ERROR_CODES = [
  "unknown_alias",
  "origin_mismatch",
  "approval_required",
  "no_passkey",
  "ceremony_failed",
] as const;
export const PasskeyErrorCode = z.enum(PASSKEY_ERROR_CODES);
export type PasskeyErrorCode = z.infer<typeof PasskeyErrorCode>;
export const UsePasskeyArgs = z.object({ alias: Alias });
export type UsePasskeyArgs = z.infer<typeof UsePasskeyArgs>;
export const UsePasskeyResult = z.union([ToolOk, z.object({ error: PasskeyErrorCode })]);
export type UsePasskeyResult = z.infer<typeof UsePasskeyResult>;

export const VideoRange = z
  .object({ start: z.number().min(0), end: z.number().positive() })
  .refine((range) => range.end > range.start, { message: "end must be after start" });
export type VideoRange = z.infer<typeof VideoRange>;
export const VideoArgs = z.object({ op: VideoOp, range: VideoRange.nullable() });
export type VideoArgs = z.infer<typeof VideoArgs>;
export const VideoResult = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("captions"),
    blockIds: z.array(Uuid),
    segments: z.number().int().nonnegative(),
    language: z.string().max(16).nullable(),
  }),
  z.object({
    op: z.literal("chapters"),
    chapters: z.array(z.object({ title: z.string().max(500), start: z.number().min(0) })),
  }),
  z.object({
    op: z.literal("keyframes"),
    blockIds: z.array(Uuid),
    kept: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative(),
    drm: z.boolean(),
  }),
  z.object({
    op: z.literal("transcribe"),
    blockIds: z.array(Uuid),
    seconds: z.number().nonnegative(),
  }),
]);
export type VideoResult = z.infer<typeof VideoResult>;

/** Function tools sent with zodResponsesFunction; `computer` is OpenAI's native tool. */
export const FUNCTION_TOOLS = {
  read_page: { args: ReadPageArgs, result: ReadPageResult },
  capture: { args: CaptureArgs, result: CaptureResult },
  fill_credential: { args: FillCredentialArgs, result: FillCredentialResult },
  use_passkey: { args: UsePasskeyArgs, result: UsePasskeyResult },
  video: { args: VideoArgs, result: VideoResult },
} as const satisfies Record<FunctionToolName, { args: z.ZodType; result: z.ZodType }>;
