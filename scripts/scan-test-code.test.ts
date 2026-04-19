import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { scanTestCode } from "./scan-test-code.ts";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function tree(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "scan-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe("scanTestCode (agent image check, carry-over 5)", () => {
  it("finds test files, testing/ directories and any file that loads a test framework", async () => {
    const dir = await tree({
      "apps/agent/src/main.ts": 'import { run } from "./run.ts";',
      "apps/agent/src/a.test.ts": "",
      "apps/agent/src/vault/testing/browser.ts": "",
      // Named like production code, but it is test code: found by what it imports.
      "packages/db/src/helpers.ts": 'import { GenericContainer } from "testcontainers";',
      "packages/db/src/spec.ts": "import { it } from 'vitest';",
      "node_modules/vitest/index.ts": "import 'vitest';",
    });
    expect(await scanTestCode(dir)).toEqual([
      "apps/agent/src/a.test.ts",
      "apps/agent/src/vault/testing",
      "packages/db/src/helpers.ts",
      "packages/db/src/spec.ts",
    ]);
  });

  it("passes a clean tree", async () => {
    expect(await scanTestCode(await tree({ "apps/agent/src/main.ts": "export {};" }))).toEqual([]);
  });
});

describe("scan-test-code CLI (review: never passes silently)", () => {
  const cli = (dir: string) =>
    promisify(execFile)("node", [
      new URL("./scan-test-code.ts", import.meta.url).pathname,
      dir,
    ]).then(
      (result) => ({ code: 0, stdout: result.stdout }),
      (error: { code: number; stdout: string }) => ({ code: error.code, stdout: error.stdout }),
    );

  it("ends a clean scan with a sentinel line the image check requires", async () => {
    const result = await cli(await tree({ "apps/agent/src/main.ts": "export {};" }));
    expect(result).toEqual({ code: 0, stdout: "scan-test-code: scanned 1 files, 0 offenders\n" });
  });

  it("lists offenders and exits 1", async () => {
    const result = await cli(await tree({ "a.test.ts": "", "b.ts": "export {};" }));
    expect(result).toEqual({
      code: 1,
      stdout: "a.test.ts\nscan-test-code: scanned 2 files, 1 offenders\n",
    });
  });
});
