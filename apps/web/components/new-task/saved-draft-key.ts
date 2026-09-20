/**
 * Where New task drafts live in localStorage. Kept apart from saved-draft.ts (and its validation)
 * so sign-out, which every page's shell carries, adds nothing to first-load JS.
 */
const KEY_PREFIX = "mt.new-task-draft:";

/** The storage key of one viewer's draft: one per account, never shared between them. */
export const draftKey = (viewerId: string): string => KEY_PREFIX + viewerId;

/** Removes every viewer's saved draft from this browser: sign-out calls it (shared browsers). */
export function clearSavedDrafts(): void {
  try {
    const store = window.localStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    for (const key of keys) if (key?.startsWith(KEY_PREFIX)) store.removeItem(key);
  } catch {
    // Storage blocked: there is nothing this page could have saved.
  }
}
