/** Where to go after signing in when no safe `next` is given. */
const HOME = "/library";
const MAX_NEXT = 512;

/**
 * A same-origin app path to return to after sign-in, or the library. Rejects anything that could
 * leave the origin ("//host", "/\\host", schemes), loop back into auth, or smuggle control chars.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || raw.length > MAX_NEXT) return HOME;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return HOME;
  if (/\p{Cc}/u.test(raw)) return HOME;
  if (/^\/(sign-in|sign-up)(?:[/?#]|$)/.test(raw)) return HOME;
  return raw;
}

/** The sign-in URL that returns the user to where the session expired. */
export function signInPathFor(pathname: string, search: string): string {
  const here = `${pathname}${search}`;
  return safeNextPath(here) === here ? `/sign-in?next=${encodeURIComponent(here)}` : "/sign-in";
}
