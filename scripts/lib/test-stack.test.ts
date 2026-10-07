import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./test-stack.sh", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "mt-test-stack-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** The DC array test-stack.sh builds when sourced from a worktree root named `dir`. */
function dcFrom(dir: string, env: Record<string, string> = {}): string[] {
  const root = join(base, dir);
  mkdirSync(root, { recursive: true });
  const out = execFileSync("bash", ["-c", `source "${script}" && printf '%s\\n' "\${DC[@]}"`], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return out.trim().split("\n");
}

describe("scripts/lib/test-stack.sh compose project (review: per-worktree names)", () => {
  it("names the stack after the worktree, so one worktree's down -v never removes another's stack", () => {
    const dc = dcFrom("houndshark-p7g2");
    expect(dc.slice(0, 4)).toEqual(["docker", "compose", "-p", "mt-houndshark-p7g2"]);
    expect(dcFrom("My Worktree.v2").slice(2, 4)).toEqual(["-p", "mt-my-worktree-v2"]);
  });

  it("keeps a name the caller set (the remote runner's per-run project)", () => {
    expect(
      dcFrom("houndshark-p7g2", { COMPOSE_PROJECT_NAME: "mt-run-abc123" }).slice(2, 4),
    ).toEqual(["-p", "mt-run-abc123"]);
  });
});
