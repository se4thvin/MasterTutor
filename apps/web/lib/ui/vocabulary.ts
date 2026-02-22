import type { SourceKind } from "@mastertutor/contracts";

/**
 * The app's UI vocabulary as plain data, so logic in lib/ can name icons and badge tones without
 * importing components. components/ui/icons.ts maps every name to a glyph and is type-checked
 * against this list (exactly these names, no more, no fewer).
 */
export const ICON_NAMES = [
  "newTask",
  "runs",
  "library",
  "vault",
  "settings",
  "web",
  "pdf",
  "video",
  "note",
  "image",
  "table",
  "code",
  "math",
  "transcript",
  "keyframe",
  "folder",
  "folderOpen",
  "folderNested",
  "folderAdd",
  "unfiled",
  "allNotes",
  "verified",
  "partial",
  "needsReview",
  "edited",
  "agentNote",
  "live",
  "ok",
  "info",
  "sealed",
  "session",
  "username",
  "password",
  "totp",
  "pin",
  "emailOtp",
  "codeOtp",
  "passkey",
  "imap",
  "hidden",
  "add",
  "search",
  "command",
  "close",
  "more",
  "move",
  "delete",
  "export",
  "link",
  "external",
  "edit",
  "check",
  "undo",
  "chevronRight",
  "chevronDown",
  "back",
  "grid",
  "list",
  "split",
  "signOut",
  "stop",
  "usage",
  "audit",
  "model",
  "budget",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export const SOURCE_KIND_ICON: Record<SourceKind, IconName> = {
  web: "web",
  pdf: "pdf",
  youtube: "video",
};

/** Status tones (Badge). Status never relies on colour alone: icon + word are required. */
export type BadgeTone = "ok" | "warn" | "neutral" | "tint" | "signal" | "danger";
