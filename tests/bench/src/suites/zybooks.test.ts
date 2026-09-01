import { describe, expect, it } from "vitest";
import {
  surveySpec,
  surveySuite,
  ZYBOOKS_BOOK,
  ZYBOOKS_ORIGIN,
  ZybooksCalibration,
  zybooksSuite,
} from "./zybooks.ts";

const calibration = ZybooksCalibration.parse({
  book: ZYBOOKS_BOOK,
  patterns: { activity: "PARTICIPATION ACTIVITY", completed: "Activity completed" },
  sections: [1, 2, 3, 4, 5].map((reading) => ({
    reading,
    title: `${reading}.1`,
    url: `${ZYBOOKS_BOOK}/chapter/${reading}/section/1`,
  })),
  calibratedAt: "2026-10-06",
  surveyRunId: "88888888-8888-4888-8888-888888888888",
});
const SIGNED_IN = { kind: "signed_in", origin: ZYBOOKS_ORIGIN, signInPath: "/signin" };

describe("zybooks suite", () => {
  it("runs on the prod-like stack and has only login benchmarks until calibrated", () => {
    const suite = zybooksSuite(null);
    expect(suite.stack).toBe("local");
    expect(suite.benchmarks.map((b) => `${b.key}@${b.toolProfile}`)).toEqual([
      "login@browser_use",
      "login@computer_use",
    ]);
  });

  it("runs every benchmark in bypass, pinned to one origin, signing in fresh with named fields (D46, P10b-4/6/18)", () => {
    for (const b of [...zybooksSuite(calibration).benchmarks, surveySpec()]) {
      expect(b.approvalMode).toBe("bypass");
      expect(b.allowedOrigins).toEqual([ZYBOOKS_ORIGIN]);
      expect(b.requiredVaultItem).toEqual({
        alias: "zybooks",
        origin: ZYBOOKS_ORIGIN,
        fields: ["username", "password"],
      });
      expect(b.freshLogin).toBe(true);
      expect(b.task).toMatch(/field "username".*field "password"/);
      expect(b.task).toMatch(/consent banner/);
      expect(b.task).not.toMatch(/password\s*[:=]/i);
      expect(b.mockScenarios).toBeNull();
    }
  });

  it("grades login as ONE run from its own trace (signed_in on main, no verify run; D46, P10b-5)", () => {
    for (const b of zybooksSuite(null).benchmarks) {
      expect(b.criterion).toEqual(SIGNED_IN);
      expect(b.verify).toBeNull();
      expect(b.baselineMustPass).toBe(false);
      expect(b.signInCheck).toBeNull();
    }
  });

  it("asks reading runs to redo already-completed work, with a baseline and signed_in on main (D32, P10b-5/7)", () => {
    const r1 = zybooksSuite(calibration).benchmarks.find(
      (b) => b.key === "reading-1" && b.toolProfile === "computer_use",
    )!;
    expect(r1.baselineMustPass).toBe(true);
    expect(r1.task).toMatch(/already completed.*redo/i);
    expect(r1.criterion).toMatchObject({ kind: "sections_complete", requireInteraction: true });
    expect(r1.signInCheck).toEqual(SIGNED_IN);
    expect(r1.verify!.task).toContain("/chapter/1/section/1");
    expect(r1.budget.maxUsd).toBe(50);
  });

  it("lets a grading run interact only on the sign-in page, and reach sections through the address bar (I3, N2)", () => {
    for (const b of zybooksSuite(calibration).benchmarks.filter((x) => x.verify !== null)) {
      expect(b.verify!.signInUrl).toBe(`${ZYBOOKS_ORIGIN}/signin`);
      expect(b.verify!.task).toMatch(/address bar/);
      expect(b.verify!.task).toMatch(/Do not click/);
      if (b.criterion.kind !== "sections_complete") throw new Error("a reading grades sections");
      for (const s of b.criterion.sections) expect(s.url.startsWith(`${ZYBOOKS_BOOK}/`)).toBe(true);
    }
  });

  it("surveys every reading in both read_page modes, as a one-benchmark suite (P10b-20)", () => {
    expect(surveySuite().benchmarks.map((b) => `${b.key}@${b.toolProfile}`)).toEqual([
      "survey@browser_use",
    ]);
    const task = surveySpec().task;
    expect(task).toMatch(/reading assignments 1 to 5/);
    expect(task).toMatch(/"text".*"interactive"/);
    expect(task).toMatch(/Do not complete or click inside any activity/);
  });

  it("rejects calibration with sections outside the book", () => {
    expect(
      ZybooksCalibration.safeParse({
        ...calibration,
        sections: [{ reading: 1, title: "x", url: "https://evil.example/x" }],
      }).success,
    ).toBe(false);
  });
});
