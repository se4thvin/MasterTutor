import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const manifest = (path: string): Manifest =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as Manifest;
const dep = (m: Manifest, name: string) => m.dependencies?.[name] ?? m.devDependencies?.[name];

describe("Playwright pins (P7-11)", () => {
  it("uses one exact Playwright version in the root, the agent and the web suites", () => {
    const root = dep(manifest("package.json"), "playwright-core");
    expect(root).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dep(manifest("apps/agent/package.json"), "playwright-core")).toBe(root);
    expect(dep(manifest("apps/web/package.json"), "@playwright/test")).toBe(root);
  });

  it("pins axe exactly", () => {
    expect(dep(manifest("apps/web/package.json"), "@axe-core/playwright")).toBe("4.13.0");
  });
});
