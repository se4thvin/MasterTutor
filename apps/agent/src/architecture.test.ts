import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

async function importsOf(dir: string): Promise<Array<{ file: string; from: string }>> {
  const files = (await readdir(join(SRC, dir))).filter((name) => name.endsWith(".ts"));
  const found: Array<{ file: string; from: string }> = [];
  for (const file of files) {
    const text = await readFile(join(SRC, dir, file), "utf8");
    for (const match of text.matchAll(/from "(\.\.\/[a-z-]+)\//g))
      found.push({ file: `${dir}/${file}`, from: match[1]! });
  }
  return found;
}

describe("module boundaries (CLAUDE.md principle 5: no circular dependencies)", () => {
  it("notes never import capture, video or pdf (preflight F15)", async () => {
    const banned = new Set(["../capture", "../video", "../pdf"]);
    expect((await importsOf("notes")).filter((entry) => banned.has(entry.from))).toEqual([]);
  });

  it("guardrails depend on tools, never the other way round", async () => {
    expect((await importsOf("tools")).filter((entry) => entry.from === "../guardrails")).toEqual(
      [],
    );
  });
});

describe("approval modes reach only the approval decisions (D44 hard invariants)", () => {
  it("the browser, network policy, masking, vault, tools and guardrails never read the approval mode", async () => {
    const readers: string[] = [];
    for (const dir of ["browser", "vault", "tools", "guardrails", "slots", "runtime"]) {
      const walk = async (path: string): Promise<void> => {
        for (const entry of await readdir(join(SRC, path), { withFileTypes: true })) {
          const child = join(path, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.name.endsWith(".ts") && !entry.name.includes(".test."))
            if (
              /approvalMode|ApprovalMode|BYPASS_DECI|decideByPolicy|policyDecider|decideSafetyChecks|AUTO_MODE_DECISIONS/.test(
                await readFile(join(SRC, child), "utf8"),
              )
            )
              readers.push(child);
        }
      };
      await walk(dir);
    }
    // So bypass mode cannot switch off the network policy, the sandbox, secret masking, the
    // vault's origin pinning, the kill switch or takeover: none of them can see the mode.
    expect(readers).toEqual([]);
  });
});
