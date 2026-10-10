import { getDomain } from "tldts";

/** D51: the private PSL section separates independent tenants (a.github.io and b.github.io). */
export function registrableDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? null;
}
export function siteKey(url: string): string {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new TypeError("Expected an http(s) site without credentials");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return registrableDomain(hostname) ?? hostname;
}
