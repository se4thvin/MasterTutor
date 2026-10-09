import { untrustedText } from "./untrusted.ts";

/** A run's short title: what the run header, the runs list and the usage table show. */
export const RUN_TITLE_MAX = 60;

/**
 * A word that reads like a token or key: long mixed-case alphanumerics with a digit, or long hex.
 * Best effort; over-matching only costs a word.
 */
export const TOKEN_LIKE =
  /^(?=[\w-]*\d)(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{20,}$|^[0-9a-fA-F]{32,}$/;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const EMAIL = /[^\s@<>()[\]"'`]+@[^\s@<>()[\]"'`]+\.[a-z]{2,}/gi;
/** "password: hunter2", "PIN=1234", "api key: …": the label stays, the value goes. */
const LABELLED_SECRET =
  /\b(passwords?|passcodes?|passwd|pins?|otp|tokens?|secrets?|api[ _-]?keys?)(\s*[:=]\s*)\S+/gi;

/** A link's host without `www.`, or null when it is not an http(s) URL. */
export function hostOf(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The hosts of the links in `text`, in order, without repeats. */
export function linkHosts(text: string): string[] {
  const hosts = (text.match(URL_IN_TEXT) ?? []).map(hostOf);
  return [...new Set(hosts.filter((host): host is string => host !== null))];
}

/**
 * Goal text with what a title never needs taken out: a link becomes its host (paths and queries
 * can carry tokens), and emails, labelled secrets and token-like words are cut.
 */
export function redactForTitle(text: string): string {
  return text
    .replace(URL_IN_TEXT, (link) => hostOf(link) ?? "…")
    .replace(EMAIL, "…")
    .replace(LABELLED_SECRET, "$1$2…")
    .replace(/[\w-]+/g, (word) => (TOKEN_LIKE.test(word) ? "…" : word));
}

/** Cut at a word boundary near `max` code points, with an ellipsis; short text is unchanged. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const space = head.lastIndexOf(" ");
  const cut = space >= max * 0.6 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.\-–—]+$/u, "")}…`;
}

/**
 * The title shown until (or unless) a generated one is stored: the goal's first non-empty line,
 * redacted like the title model's input and cut cleanly. Existing runs show this (no backfill).
 */
export function fallbackRunTitle(goal: string): string {
  const line = goal.split("\n").find((part) => part.trim() !== "") ?? "";
  return clip(untrustedText(redactForTitle(line), 4_000), RUN_TITLE_MAX) || "Untitled run";
}
