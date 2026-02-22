import type { BlockOrigin, NoteBlock, SourceView } from "@mastertutor/contracts";
import type { BadgeTone, IconName } from "@/lib/ui/vocabulary.ts";
import { formatTimestamp } from "./format.ts";

export type ProvenanceStatus = "verified" | "needs_review" | "edited" | "model";

const ORIGIN_LABEL: Record<BlockOrigin, string> = {
  dom: "Page text",
  pdf: "PDF text layer",
  captions: "Uploader captions",
  asr: "Transcribed audio",
  ocr_model: "Read from an image",
  model: "Written by the agent",
  user: "Written by you",
};

/** Why an unverified block needs a look, by where its text came from (one source: reader and export). */
export const REVIEW_REASON: Record<BlockOrigin, string> = {
  ocr_model: "Read from an image by the model.",
  asr: "Transcribed from the audio by the model.",
  dom: "Not yet matched to the page text.",
  pdf: "Not yet matched to the PDF's text.",
  captions: "From the uploader's captions, not yet checked against the audio.",
  model: "Written by the agent.",
  user: "Written by you and not yet checked.",
};

const STATUS: Record<ProvenanceStatus, { label: string; icon: IconName; tone: BadgeTone }> = {
  verified: { label: "Verified", icon: "verified", tone: "ok" },
  needs_review: { label: "Needs review", icon: "needsReview", tone: "warn" },
  edited: { label: "Edited by you", icon: "edited", tone: "tint" },
  model: { label: "Agent's note", icon: "agentNote", tone: "neutral" },
};

export function statusOf(block: NoteBlock): ProvenanceStatus {
  if (block.origin === "model") return "model";
  if (!block.verified) return "needs_review";
  if (block.edited) return "edited";
  return "verified";
}

/** Mark verified shows for model-read images and any unverified block, and stays once verified (T21). */
export const showsVerifyCheck = (block: Pick<NoteBlock, "origin" | "verified">) =>
  block.origin === "ocr_model" || !block.verified;

export const isRawHtmlTable = (block: NoteBlock) =>
  block.type === "table" && block.markdown.trimStart().startsWith("<");

/** Only http(s) page URLs are ever offered as "Open on page"; anything else is dropped. */
export function safePageUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

export function provenanceOf(block: NoteBlock, source: SourceView | undefined) {
  const status = statusOf(block);
  const meta = STATUS[status];
  const a = block.anchor;
  const where =
    a?.tStart !== undefined
      ? `${formatTimestamp(a.tStart)}${a.tEnd !== undefined && a.tEnd !== a.tStart ? `–${formatTimestamp(a.tEnd)}` : ""}`
      : a?.page !== undefined
        ? `Page ${a.page}`
        : null;
  let openUrl: string | null = null;
  const page = source ? safePageUrl(source.url) : null;
  if (source && page && block.origin !== "model") {
    if (source.kind === "youtube" && a?.tStart !== undefined) {
      page.searchParams.set("t", `${Math.floor(a.tStart)}s`);
      openUrl = page.toString();
    } else if (source.kind === "pdf" && a?.page !== undefined) {
      openUrl = `${source.url}#page=${a.page}`;
    } else if (a?.textFragment) {
      openUrl = `${source.url}#:~:text=${encodeURIComponent(a.textFragment)}`;
    } else {
      openUrl = source.url;
    }
  }
  const plain = (a?.textFragment ?? block.markdown)
    .replace(/[#*_`>$|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    status,
    statusLabel: meta.label,
    icon: meta.icon,
    tone: meta.tone,
    originLabel: ORIGIN_LABEL[block.origin],
    snippet: plain.length > 180 ? `${plain.slice(0, 180)}…` : plain,
    selector: a?.selector ?? null,
    hashShort: block.contentSha256 ? `${block.contentSha256.slice(0, 8)}…` : null,
    where,
    openUrl,
  };
}

/** Margin callouts (cutaway device): only blocks whose provenance is worth a glance. */
export function calloutFor(
  block: NoteBlock,
): { lead: string; text: string; status: ProvenanceStatus } | null {
  const status = statusOf(block);
  if (status === "needs_review") {
    return {
      lead: "Needs review.",
      text: `${REVIEW_REASON[block.origin]} Check it against the source.`,
      status,
    };
  }
  if (status === "edited") {
    return { lead: "Edited by you.", text: "The captured original is kept.", status };
  }
  if (status === "model") {
    return { lead: "Agent's note.", text: "Written by the agent, not captured.", status };
  }
  if (block.anchor?.tStart !== undefined && block.type === "keyframe") {
    return {
      lead: `Keyframe at ${formatTimestamp(block.anchor.tStart)}.`,
      text: "Captured from the player.",
      status,
    };
  }
  switch (block.type) {
    case "table":
      return { lead: "Table.", text: "Copied cell by cell from the page.", status };
    case "math":
      return { lead: "Math.", text: "Re-typeset from the page's markup.", status };
    case "code":
      return { lead: "Code.", text: "Byte-exact, whitespace kept.", status };
    case "figure":
    case "image":
      return { lead: "Figure.", text: "The original image, stored as captured.", status };
    default:
      return null;
  }
}
