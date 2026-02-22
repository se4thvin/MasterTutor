/**
 * Block edits in flight, kept per tab until the server confirms them, so a failed save (or a
 * session that ended mid-save and a sign-in round trip) never loses the user's text. Note text
 * only: nothing secret is ever stored. Storage can be unavailable; then drafts live as long as
 * the page does.
 */
const KEY = (blockId: string) => `mt:block-draft:${blockId}`;
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function keepDraft(blockId: string, markdown: string): void {
  memory.set(blockId, markdown);
  try {
    storage()?.setItem(KEY(blockId), markdown);
  } catch {
    // Quota or privacy mode: the in-memory copy still covers a failed save on this page.
  }
}

export function draftFor(blockId: string): string | null {
  try {
    const stored = storage()?.getItem(KEY(blockId));
    if (stored != null) return stored;
  } catch {
    // Fall through to memory.
  }
  return memory.get(blockId) ?? null;
}

export function dropDraft(blockId: string): void {
  memory.delete(blockId);
  try {
    storage()?.removeItem(KEY(blockId));
  } catch {
    // Nothing to clean.
  }
}

/** The first of these blocks that still has an unsaved draft, if any. */
export const firstDraftedBlock = (blockIds: readonly string[]) =>
  blockIds.find((id) => draftFor(id) !== null) ?? null;
