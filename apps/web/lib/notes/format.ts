import type { Fidelity, NoteSummary, SourceKind } from "@mastertutor/contracts";
import { SOURCE_KIND_ICON, type BadgeTone, type IconName } from "@/lib/ui/vocabulary.ts";

export const KIND_LABEL: Record<SourceKind, string> = {
  web: "Web page",
  pdf: "PDF",
  youtube: "Video",
};

export function noteKindIcon(note: Pick<NoteSummary, "sourceKinds">): IconName {
  return SOURCE_KIND_ICON[note.sourceKinds[0] ?? "web"];
}

export const FIDELITY_META: Record<Fidelity, { label: string; tone: BadgeTone; icon: IconName }> = {
  verified: { label: "Verified", tone: "ok", icon: "verified" },
  partial: { label: "Partial", tone: "warn", icon: "partial" },
  needs_review: { label: "Needs review", tone: "warn", icon: "needsReview" },
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "";
  }
}

/** 768 → "12:48"; 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm.padStart(2, "0")}:${ss}`;
}
