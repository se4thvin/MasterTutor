import { toOrigin, Uuid } from "@mastertutor/contracts";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { z } from "zod";
import { BUDGET_PRESETS, parseSource, type BudgetPreset, type SourceChip } from "./draft.ts";
import { draftKey } from "./saved-draft-key.ts";

/**
 * The New task draft, kept per viewer in this browser so leaving the page loses nothing.
 * A per-viewer convenience only: storage may be blocked or throw, and the page works without it.
 *
 * Never kept: the approval mode and the bypass acknowledgement (S10, D44: always chosen afresh),
 * text still being typed into the add-source and add-domain fields, and any URL that looks like it
 * carries a credential: such a source is left out, and such a link in the goal is cut back to its
 * origin. That check is best effort (a heuristic over query, fragment and path; it fails closed
 * on anything that looks like a token). Sign-out removes every saved draft (saved-draft-key.ts).
 */
interface SavedDraft {
  goal: string;
  sources: SourceChip[];
  /** null: the Settings default allowlist shows through. */
  domains: string[] | null;
  budget: BudgetPreset;
  folderId: string | null;
}

export const EMPTY_DRAFT: SavedDraft = {
  goal: "",
  sources: [],
  domains: null,
  budget: "standard",
  folderId: null,
};

const SAVE_DEBOUNCE_MS = 400;
const GOAL_MAX = 4_000;
const LIST_MAX = 50;
const SECRET_PARAM = /token|key|sig|secret|pass|auth|session|credential|otp|code|^[tks]$/i;
/** A path segment that reads like a token: long, mixed-case alphanumerics with a digit, or long hex. */
const TOKEN_SEGMENT = /^(?=[\w-]*\d)(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{20,}$|^[0-9a-fA-F]{32,}$/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;

const Stored = z.object({
  v: z.literal(1),
  goal: z.string().max(GOAL_MAX),
  sources: z.array(z.string().max(4_096)).max(LIST_MAX),
  domains: z.array(z.string().max(512)).max(LIST_MAX).nullable(),
  budget: z.enum(Object.keys(BUDGET_PRESETS) as [BudgetPreset, ...BudgetPreset[]]),
  folderId: Uuid.nullable(),
});

/**
 * Best effort: a URL is treated as carrying a credential when a query or fragment parameter has a
 * credential-like name (`?token=`, `#access_token=`, `?k=`), or a path segment reads like a token.
 * Over-matching is fine (the source just isn't kept); anything unparsable fails closed.
 */
export function mayHoldCredential(url: string): boolean {
  try {
    const parsed = new URL(url);
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    const names = [...parsed.searchParams.keys(), ...fragment.keys()];
    if (names.some((name) => SECRET_PARAM.test(name))) return true;
    return parsed.pathname
      .split("/")
      .some((segment) => TOKEN_SEGMENT.test(decodeURIComponent(segment)));
  } catch {
    return true;
  }
}

/** Links pasted into the goal that look like they carry a credential are cut back to their origin. */
function redactGoal(goal: string): string {
  return goal.replace(URL_IN_TEXT, (link) => {
    if (!mayHoldCredential(link)) return link;
    const origin = toOrigin(link);
    return origin ? `${origin}/…` : "…";
  });
}

/** What would be stored, or null for a draft with nothing worth keeping. */
export function serializeDraft(draft: SavedDraft): string | null {
  const sources = draft.sources.map((s) => s.url).filter((url) => !mayHoldCredential(url));
  const empty =
    draft.goal.trim() === "" &&
    sources.length === 0 &&
    draft.domains === null &&
    draft.budget === EMPTY_DRAFT.budget &&
    draft.folderId === null;
  if (empty) return null;
  return JSON.stringify({
    v: 1,
    goal: redactGoal(draft.goal).slice(0, GOAL_MAX),
    sources: sources.slice(0, LIST_MAX),
    domains: draft.domains?.slice(0, LIST_MAX) ?? null,
    budget: draft.budget,
    folderId: draft.folderId,
  });
}

/** Storage is untrusted input: anything malformed is dropped, and each value re-validated. */
export function parseDraft(raw: string | null): SavedDraft | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const stored = Stored.safeParse(json);
  if (!stored.success) return null;
  const { goal, budget, folderId } = stored.data;
  const sources = stored.data.sources.flatMap((url) => {
    const chip = parseSource(url);
    return chip && !mayHoldCredential(chip.url) ? [chip] : [];
  });
  const domains =
    stored.data.domains === null
      ? null
      : [...new Set(stored.data.domains.flatMap((d) => toOrigin(d) ?? []))];
  return { goal, sources, domains, budget, folderId };
}

/** Every storage access can throw (blocked, private mode, quota): each is wrapped. */
const storage = {
  read(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key: string, value: string | null): void {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Not kept; the page goes on with what is on screen.
    }
  },
};

/**
 * Restores the viewer's draft once after mount (so the server render matches), then saves
 * changes debounced, flushing on unmount and pagehide. clear() forgets it, for after a run starts.
 */
export function useSavedDraft(
  viewerId: string,
  draft: SavedDraft,
  restore: (saved: SavedDraft) => void,
): { clear(): void } {
  const key = draftKey(viewerId);
  const [ready, setReady] = useState(false);
  const pending = useRef<{ value: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRestore = useEffectEvent(restore);
  const serialized = serializeDraft(draft);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) storage.write(key, pending.current.value);
    pending.current = null;
  }, [key]);

  useEffect(() => {
    const saved = parseDraft(storage.read(key));
    if (saved) onRestore(saved);
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    pending.current = { value: serialized };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [ready, serialized, flush]);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    storage.write(key, null);
  }, [key]);

  return { clear };
}
