import { z } from "zod";
import { toOrigin } from "./primitives.ts";
import { isLocalhost, isPrivateAddress } from "./private-address.ts";

/** Source chips and goal hints use the same URL rules; DNS/egress checks still apply at navigation. */
export const SourceUrl = z
  .string()
  .trim()
  .transform((input, ctx) => {
    const origin = toOrigin(input);
    let url: URL | null = null;
    try {
      url = new URL(input);
    } catch {
      /* Refuse malformed URLs below. */
    }
    if (
      origin === null ||
      url === null ||
      isLocalhost(url.hostname) ||
      ((url.hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) &&
        isPrivateAddress(url.hostname))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Expected a public http(s) source URL without credentials",
      });
      return z.NEVER;
    }
    return url.href;
  });

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** The single source-hint extractor. Reject unsafe hints rather than silently authorizing them. */
export function goalSourceUrls(goal: string): string[] {
  return [
    ...new Set(
      [...goal.matchAll(URL_IN_TEXT)].map((match) =>
        SourceUrl.parse(match[0].replace(/[.,;:!?]+$/, "")),
      ),
    ),
  ];
}
