import { describe, expect, it } from "vitest";
import { baselineCriterion, evaluate } from "../criteria.ts";
import { addressBar, observe, readLinks, readPage, traceOf } from "../trace-fixtures.ts";
import { DISCOVERY, ZYBOOKS_BOOK, ZYBOOKS_ORIGIN, zybooksSuite } from "./zybooks.ts";

const SIGNED_IN = { kind: "signed_in", origin: ZYBOOKS_ORIGIN, signInPath: "/signin" };
const find = (key: string, track = "browser_use") =>
  zybooksSuite().benchmarks.find((b) => b.key === key && b.toolProfile === track)!;

describe("zybooks suite", () => {
  it("runs on the prod-like stack: run 1 (full task), login, and one benchmark per reading, on both tracks", () => {
    const suite = zybooksSuite();
    expect(suite.stack).toBe("local");
    expect(suite.benchmarks.map((b) => `${b.key}@${b.toolProfile}`).slice(0, 4)).toEqual([
      "full@browser_use",
      "full@computer_use",
      "login@browser_use",
      "login@computer_use",
    ]);
    expect(suite.benchmarks.filter((b) => b.key.startsWith("reading-"))).toHaveLength(10);
  });

  it("runs every benchmark in bypass, pinned to one origin, signing in fresh with named fields (D46, P10b-4/6/18)", () => {
    for (const b of zybooksSuite().benchmarks) {
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

  it("run 1 is ONE agent run with the full goal: the agent finds readings 1-5 itself and redoes them ($50)", () => {
    const full = find("full");
    expect(full.task).toMatch(/find reading assignments 1 to 5 and every section/);
    expect(full.task).toMatch(/already completed.*redo/i);
    expect(full.task).not.toContain("/chapter/");
    expect(full.budget.maxUsd).toBe(50);
    expect(full.baselineMustPass).toBe(false);
    expect(full.signInCheck).toEqual(SIGNED_IN);
    expect(full.criterion).toMatchObject({
      kind: "discovered_readings",
      readings: [1, 2, 3, 4, 5],
      requireInteraction: true,
    });
  });

  it("grades with a read-only run that discovers the sections itself and may interact only on the sign-in page (I3, N2)", () => {
    for (const b of zybooksSuite().benchmarks.filter((x) => x.verify !== null)) {
      expect(b.verify!.signInUrl).toBe(`${ZYBOOKS_ORIGIN}/signin`);
      expect(b.verify!.task).toMatch(/address bar/);
      expect(b.verify!.task).toMatch(/Never click, type or press keys/);
      expect(b.verify!.task).toContain(ZYBOOKS_BOOK);
    }
  });

  it("grades login as ONE run from its own trace (signed_in on main, no grading run; D46, P10b-5)", () => {
    for (const track of ["browser_use", "computer_use"]) {
      const b = find("login", track);
      expect(b.criterion).toEqual(SIGNED_IN);
      expect(b.verify).toBeNull();
    }
  });

  it("reads zyBooks-shaped pages: reading entries, section links inside the book only", () => {
    const assignments = `${ZYBOOKS_BOOK}/assignments`;
    const section = `${ZYBOOKS_BOOK}/chapter/1/section/2`;
    const grading = traceOf([
      addressBar(assignments),
      observe(assignments),
      readLinks(assignments, [
        { name: "Reading 1" },
        {
          name: "1.2 Variables",
          href: "/zybook/UTDALLASCE2310EE2310AkourFall2026/chapter/1/section/2",
        },
        { name: "Elsewhere", href: "https://evil.example/zybook/x/chapter/1/section/2" },
      ]),
      addressBar(section),
      observe(section),
      readPage(section, "PARTICIPATION ACTIVITY 1.2.1 ... Activity completed"),
    ]);
    const verdict = evaluate(baselineCriterion(find("reading-1").criterion), null, grading);
    expect(verdict.sections).toEqual([
      {
        reading: 1,
        title: "1.2 Variables",
        url: section,
        outcome: "passed",
        reason: "1/1 activities complete",
      },
    ]);
    expect(
      new RegExp(DISCOVERY.sectionUrlPattern).test(
        "https://evil.example/zybook/x/chapter/1/section/2",
      ),
    ).toBe(false);
  });
});
