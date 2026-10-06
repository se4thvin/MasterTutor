import { z } from "zod";
import { VIEWPORT } from "./constants.ts";
import { ANNOTATE_KINDS, CredentialField, Fidelity, VideoOp } from "./enums.ts";
import { Alias, ElementRef, Sha256Hex, Uuid } from "./primitives.ts";

/** Exactly these tools reach the model (spec §6). There is no exec_* tool. */
export const TOOL_NAMES = [
  "computer",
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
  "annotate",
] as const;
export const ToolName = z.enum(TOOL_NAMES);
export type ToolName = z.infer<typeof ToolName>;
export const FUNCTION_TOOL_NAMES = [
  "read_page",
  "capture",
  "fill_credential",
  "use_passkey",
  "video",
  "annotate",
] as const satisfies readonly ToolName[];
export type FunctionToolName = (typeof FUNCTION_TOOL_NAMES)[number];

const X = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.width - 1);
const Y = z
  .number()
  .int()
  .min(0)
  .max(VIEWPORT.height - 1);
const Point = z.object({ x: X, y: Y });
const ScrollDelta = z.number().int().min(-10_000).max(10_000);

export const COMPUTER_ACTION_TYPES = [
  "click",
  "double_click",
  "drag",
  "move",
  "scroll",
  "keypress",
  "type",
  "wait",
  "screenshot",
] as const;
/** Allowlist over OpenAI's native computer_call actions; anything else is rejected. */
export const ComputerAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: X,
    y: Y,
    button: z.enum(["left", "right", "wheel", "back", "forward"]).default("left"),
  }),
  z.object({ type: z.literal("double_click"), x: X, y: Y }),
  z.object({ type: z.literal("drag"), path: z.array(Point).min(2).max(100) }),
  z.object({ type: z.literal("move"), x: X, y: Y }),
  z.object({ type: z.literal("scroll"), x: X, y: Y, scroll_x: ScrollDelta, scroll_y: ScrollDelta }),
  z.object({ type: z.literal("keypress"), keys: z.array(z.string().min(1).max(32)).min(1).max(8) }),
  z.object({ type: z.literal("type"), text: z.string().max(5_000) }),
  z.object({ type: z.literal("wait") }),
  z.object({ type: z.literal("screenshot") }),
]);
export type ComputerAction = z.infer<typeof ComputerAction>;
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
export const ReadPageArgs = z.object({
  mode: z.enum(["interactive", "text"]),
  sinceHash: Sha256Hex.nullable(),
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
  z.object({ ...PageHeader, elements: z.array(ReadPageElement).max(2_000) }),
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
  noteId: Uuid,
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
  "fill_failed",
] as const;
export const CredentialErrorCode = z.enum(CREDENTIAL_ERROR_CODES);
export type CredentialErrorCode = z.infer<typeof CredentialErrorCode>;
export const FillCredentialArgs = z.object({
  alias: Alias,
  field: CredentialField,
  target: ElementRef,
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

export const AnnotateArgs = z.object({
  noteId: Uuid,
  afterBlockId: Uuid.nullable(),
  markdown: z.string().min(1).max(20_000),
  kind: z.enum(ANNOTATE_KINDS),
});
export type AnnotateArgs = z.infer<typeof AnnotateArgs>;
export const AnnotateResult = z.object({ blockId: Uuid });
export type AnnotateResult = z.infer<typeof AnnotateResult>;

/** Function tools sent with zodResponsesFunction; `computer` is OpenAI's native tool. */
export const FUNCTION_TOOLS = {
  read_page: { args: ReadPageArgs, result: ReadPageResult },
  capture: { args: CaptureArgs, result: CaptureResult },
  fill_credential: { args: FillCredentialArgs, result: FillCredentialResult },
  use_passkey: { args: UsePasskeyArgs, result: UsePasskeyResult },
  video: { args: VideoArgs, result: VideoResult },
  annotate: { args: AnnotateArgs, result: AnnotateResult },
} as const satisfies Record<FunctionToolName, { args: z.ZodType; result: z.ZodType }>;
