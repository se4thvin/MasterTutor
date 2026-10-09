import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCodeIndex } from "./code-index.ts";
import { buildIndex } from "./bin/build-code-index.ts";

describe("the code index build (spec §7.5)", () => {
  it("validates the snapshot shape and paths when loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-index-load-"));
    const file = join(root, "index.json");
    try {
      await writeFile(file, JSON.stringify([{ path: "../../private.ts", lines: ["x"] }]));
      await expect(loadCodeIndex(file)).rejects.toThrow();
      const path = "apps/web/app/(app)/runs/[id]/page.tsx";
      await writeFile(file, JSON.stringify([{ path, lines: ["export {};"] }]));
      expect((await loadCodeIndex(file)).read(path, 1, 1)).toEqual(["export {};"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps apps, packages and infra source, drops secrets, fixtures, tests and env files, and scrubs tokens", async () => {
    const root = await mkdtemp(join(tmpdir(), "code-index-"));
    const put = async (path: string, text: string) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    };
    await put("apps/agent/src/a.ts", "const key = 'sk-abcdefghijklmnopqrstu';\nexport {};");
    await put("apps/agent/src/a.test.ts", "test");
    await put("packages/x/.env", "OPENAI_API_KEY=x");
    await put("tests/fixtures/vault-sites/pages.ts", "password");
    await put("infra/tls/server.key", "-----BEGIN");
    await put("orchestration/STATE.md", "x");
    await put("hidden.txt", "private canary");
    await symlink(join(root, "hidden.txt"), join(root, "apps/agent/src/link.ts"));
    await put("apps/agent/src/binary.ts", "\0binary");
    await put("apps/agent/src/huge.ts", "x".repeat(512 * 1024 + 1));
    const files = await buildIndex(root);
    expect(files.map((f) => f.path)).toEqual(["apps/agent/src/a.ts"]);
    expect(files[0]!.lines[0]).not.toContain("sk-abcdefghijklmnopqrstu");
    await rm(root, { recursive: true, force: true });
  });
});
