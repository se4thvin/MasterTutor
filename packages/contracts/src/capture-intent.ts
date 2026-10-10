import { z } from "zod";
import { Uuid } from "./primitives.ts";

// Schema construction is pure. Let each client bundle omit schemas used only by server models/RPCs.

export const CAPTURE_CATEGORIES = [
  "reading_text",
  "definitions",
  "figures",
  "tables",
  "worked_examples",
  "activities",
  "due_dates",
  "scores",
  "navigation",
  "platform_chrome",
] as const;
export const CaptureCategory = /* @__PURE__ */ z.enum(CAPTURE_CATEGORIES);
export type CaptureCategory = z.infer<typeof CaptureCategory>;
export const CAPTURE_SCOPE_NOTE_MAX = 500;
export const ScopeScreenInput = /* @__PURE__ */ z.strictObject({
  workspaceId: Uuid,
  text: z.string().max(CAPTURE_SCOPE_NOTE_MAX),
});
const shape = {
  keep: z.array(CaptureCategory).max(CAPTURE_CATEGORIES.length),
  skip: z.array(CaptureCategory).max(CAPTURE_CATEGORIES.length),
  scopeNote: z.string().max(CAPTURE_SCOPE_NOTE_MAX),
};
export const CaptureBrief = /* @__PURE__ */ z.strictObject(shape).superRefine((value, ctx) => {
  if (value.keep.some((item) => value.skip.includes(item)))
    ctx.addIssue({ code: "custom", message: "Keep and skip must not overlap" });
  if (
    new Set(value.keep).size !== value.keep.length ||
    new Set(value.skip).size !== value.skip.length
  )
    ctx.addIssue({ code: "custom", message: "Choices must be unique" });
});
export type CaptureBrief = z.infer<typeof CaptureBrief>;
export const CaptureIntent = /* @__PURE__ */ z.strictObject({
  brief: CaptureBrief,
  ambiguous: z.boolean(),
});
export type CaptureIntent = z.infer<typeof CaptureIntent>;
export const CaptureQuestion = /* @__PURE__ */ z.object({
  question: z.string().min(1).max(160),
  domains: z.array(z.string().min(1).max(253)).max(50),
});
export type CaptureQuestion = z.infer<typeof CaptureQuestion>;
export const CaptureSelection = /* @__PURE__ */ z.strictObject({
  ids: z.array(z.string().regex(/^b[0-9]+$/)).max(100),
});
export type CaptureSelection = z.infer<typeof CaptureSelection>;
export const SitePreference = /* @__PURE__ */ z.object({
  domain: z.string().min(1).max(253),
  brief: CaptureBrief,
});
export type SitePreference = z.infer<typeof SitePreference>;
export const SetCaptureBriefInput = /* @__PURE__ */ z.object({ runId: Uuid, brief: CaptureBrief });
export type SetCaptureBriefInput = z.infer<typeof SetCaptureBriefInput>;
export const SetCapturePreferenceInput = /* @__PURE__ */ z.object({
  url: z.url().max(4096),
  brief: CaptureBrief,
});
