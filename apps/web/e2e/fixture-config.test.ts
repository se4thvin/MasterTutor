import { afterEach, describe, expect, it, vi } from "vitest";

/** The fixture-mode Playwright config (apps/web/playwright.config.ts) under the D45/D48 host rules. */
async function loadConfig(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("../playwright.config.ts")).default;
}

afterEach(() => vi.unstubAllEnvs());

describe("fixture UI config (Phase 8 review I2, I3)", () => {
  it("never writes a visual baseline unless asked on the command line (I2)", async () => {
    const config = await loadConfig({ CI: "1" });
    expect(config.updateSnapshots).toBe("none");
    expect(config.retries).toBe(0);
  });

  it("serves the fixture app on loopback only, built or dev (I3)", async () => {
    for (const PW_DEV of [undefined, "1"]) {
      const config = await loadConfig({ PW_DEV });
      const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
      expect(server?.command).toMatch(/next (start|dev) -H 127\.0\.0\.1 -p \d+$/);
      expect(config.use?.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    }
  });
});
