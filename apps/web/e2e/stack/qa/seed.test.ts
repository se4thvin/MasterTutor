import { APPROVAL_KINDS } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { SEED, goalOf, seedRuns, seedSql } from "./seed.ts";

describe("QA seed (Phase 8 Task 8)", () => {
  const runs = seedRuns();
  const sql = seedSql();

  it("mirrors runs_wait_reason_matches_status: a wait reason exactly when waiting", () => {
    for (const run of runs)
      expect(run.waitReason !== null, run.label).toBe(run.status === "waiting");
  });

  it("mirrors runs_control_user_matches_controller: only the takeover run is user-held (P8-6)", () => {
    expect(runs.filter((r) => r.controller === "user").map((r) => r.id)).toEqual([
      SEED.runs.takeover,
    ]);
    expect(sql).toMatch(/control_user_id[\s\S]*\(select user_id from workspace_members/);
  });

  it("covers every approval kind with a waiting run and a pending approval (P8-9)", () => {
    for (const kind of APPROVAL_KINDS) {
      expect(sql).toContain(SEED.approvalRuns[kind]);
      expect(sql).toContain(SEED.approvals[kind]);
    }
  });

  it("gives every run a distinct goal the catalog can find on screen", () => {
    const goals = runs.map((r) => goalOf(r.label));
    expect(new Set(goals).size).toBe(goals.length);
  });

  it("writes real newlines, never a literal backslash-n (P8-11)", () => {
    expect(sql).not.toContain("\\n");
    expect(sql).toContain("| Year | Event |\n|---|---|");
  });

  it("is one transaction", () => {
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});
