import { getDomain } from "tldts";

/**
 * Which top-level documents a run may open without asking (D51). The private-range network policy
 * (network-policy.ts) applies on top of this, whatever it answers.
 *
 * 1. An origin the run is allowed (its sources, and every origin a person or the run's mode
 *    approved).
 * 2. Another host on the same site as one of those: the same registrable domain (eTLD+1, by the
 *    public suffix list with its private section, so `a.github.io` and `b.github.io` stay apart),
 *    over the same scheme or https (never a downgrade to http). An IP address or a bare public
 *    suffix has no site: it matches only exactly.
 * 3. While a sign-in flow the person approved is open (sign-in-flow.ts): any https origin, so the
 *    site can send the sign-in through its identity provider. Bounded by that flow, never kept.
 */
export function registrableDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? null;
}

function parse(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/** Rule 2: `origin` is on the same site as `allowed` (not a downgrade from https). */
export function sameSite(origin: string, allowed: string): boolean {
  const target = parse(origin);
  const known = parse(allowed);
  if (!target || !known) return false;
  if (target.protocol !== known.protocol && target.protocol !== "https:") return false;
  const site = registrableDomain(target.hostname);
  return site !== null && site === registrableDomain(known.hostname);
}

/** Rules 1 and 2. */
export function inRunScope(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((allowed) => allowed === origin || sameSite(origin, allowed));
}

/** Rules 1 to 3: a top-level navigation to `origin` needs no approval. */
export function allowsTopLevel(
  origin: string,
  allowedOrigins: readonly string[],
  signInFlowOpen: boolean,
): boolean {
  if (inRunScope(origin, allowedOrigins)) return true;
  return signInFlowOpen && origin.startsWith("https://");
}
