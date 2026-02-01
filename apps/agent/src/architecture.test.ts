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
  it("guardrails depend on tools, never the other way round", async () => {
    expect((await importsOf("tools")).filter((entry) => entry.from === "../guardrails")).toEqual(
      [],
    );
  });
});
