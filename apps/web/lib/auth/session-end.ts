import { signInPathFor } from "./next-path.ts";

const listeners = new Set<() => void>();
let ended = false;

/** Runs `fn` when the session ends (for example, to drop this user's cached data). */
export function onSessionEnd(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True once the tab is on its way back to sign-in; nothing new should be shown or sent. */
export const hasSessionEnded = () => ended;

/**
 * The one response to an ended session, however it was discovered (any RPC, read or write):
 * once per tab, tell the listeners, then replace the page with sign-in, remembering where the
 * user was. A full navigation also discards every other piece of in-memory state.
 */
export function endSession(): void {
  if (ended) return;
  ended = true;
  for (const fn of listeners) fn();
  const { pathname, search } = window.location;
  window.location.replace(signInPathFor(pathname, search));
}
