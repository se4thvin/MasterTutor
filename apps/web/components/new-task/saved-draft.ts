import { toOrigin, Uuid } from "@mastertutor/contracts";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { z } from "zod";
import { BUDGET_PRESETS, parseSource, type BudgetPreset, type SourceChip } from "./draft.ts";

/**
 * The New task draft, kept per viewer in this browser so leaving the page loses nothing.
 * A per-viewer convenience only: storage may be blocked or throw, and the page works without it.
 *
 * Never kept: the approval mode and the bypass acknowledgement (S10, D44: always chosen afresh),
 * text still being typed into the add-source and add-domain fields, and any source URL whose
 * query looks like it carries a credential (a token, key or signature).
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

const KEY_PREFIX = "mt.new-task-draft:";
const SAVE_DEBOUNCE_MS = 400;
const GOAL_MAX = 4_000;
const LIST_MAX = 50;
const SECRET_PARAM = /token|key|sig|secret|pass|auth|session|credential|otp|code/i;

const Stored = z.object({
  v: z.literal(1),
  goal: z.string().max(GOAL_MAX),
  sources: z.array(z.string().max(4_096)).max(LIST_MAX),
  domains: z.array(z.string().max(512)).max(LIST_MAX).nullable(),
  budget: z.enum(Object.keys(BUDGET_PRESETS) as [BudgetPreset, ...BudgetPreset[]]),
  folderId: Uuid.nullable(),
});

/** A URL whose query names a credential-like parameter is never written to storage. */
export function mayHoldCredential(url: string): boolean {
  try {
    return [...new URL(url).searchParams.keys()].some((name) => SECRET_PARAM.test(name));
  } catch {
    return true;
  }
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
    goal: draft.goal.slice(0, GOAL_MAX),
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
  const key = KEY_PREFIX + viewerId;
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
