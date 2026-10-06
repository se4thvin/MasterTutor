/** Test-only fixture backend cookies (WEB_FIXTURE_API=1). Each Playwright test gets its own namespace. */
export const FIXTURE_NS_COOKIE = "mt_fixture_ns";
export const FIXTURE_AUTH_COOKIE = "mt_fixture_auth";

const NAMESPACE = /^[A-Za-z0-9-]{1,64}$/;

export function fixtureNamespaceFrom(cookieHeader: string | null): string {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === FIXTURE_NS_COOKIE) {
      const value = rest.join("=");
      return NAMESPACE.test(value) ? value : "default";
    }
  }
  return "default";
}
