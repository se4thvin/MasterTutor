import { describe, expect, it } from "vitest";
import { evaluate } from "./criteria.ts";
import { discoverReadings } from "./discovery.ts";
import { addressBar, computer, observe, readLinks, readPage, traceOf } from "./trace-fixtures.ts";
import type { Criterion } from "./types.ts";

const SITE = "http://bench.fixtures.test:8080";
const INDEX = `${SITE}/library`;
const reading = (n: number) => `${SITE}/library/reading/${n}`;
const section = (r: number, m: number) => `${SITE}/library/chapter/${r}/section/${m}`;
const criterion = (over: Partial<Extract<Criterion, { kind: "discovered_readings" }>> = {}) =>
  ({
    kind: "discovered_readings",
    readings: [1, 2, 3],
    readingPattern: "^Reading (\\d+)$",
    sectionUrlPattern: `^${SITE}/library/chapter/\\d+/section/\\d+$`,
    activityPattern: "PARTICIPATION ACTIVITY",
    completedPattern: "Activity completed",
    requireInteraction: false,
    ...over,
  }) as const satisfies Criterion;
const page = (activities: number, done: number) =>
  `${"PARTICIPATION ACTIVITY ".repeat(activities)}${"Activity completed ".repeat(done)}`;

/** A grading run over the library: index, each reading page, then the sections it read. */
const grading = traceOf([
  observe(INDEX),
  readLinks(INDEX, [
    { name: "Reading 1", href: "/library/reading/1" },
    { name: "Reading 2", href: "/library/reading/2" },
    { name: "Reading 3", href: "/library/reading/3" },
    { name: "Reading 4", href: "/library/reading/4" },
  ]),
  addressBar(reading(1)),
  observe(reading(1)),
  readLinks(reading(1), [
    { name: "1.1 Variables", href: "/library/chapter/1/section/1" },
    { name: "1.2 Types", href: "/library/chapter/1/section/2" },
    { name: "Back to the library", href: "/library" },
  ]),
  addressBar(reading(2)),
  observe(reading(2)),
  readLinks(reading(2), [
    { name: "2.1 Loops", href: "/library/chapter/2/section/1" },
    { name: "2.2 Functions", href: "/library/chapter/2/section/2" },
  ]),
  addressBar(reading(3)),
  observe(reading(3)),
  readLinks(reading(3), [
    { name: "3.1 Overview", href: "/library/chapter/3/section/1" },
    { name: "3.2 Review", href: "/library/chapter/3/section/2" },
  ]),
  ...[
    [section(1, 1), page(2, 2)],
    [section(1, 2), page(1, 1)],
    [section(2, 1), page(2, 1)],
    [section(2, 2), page(2, 2)],
    [section(3, 1), "An overview with no activities."],
  ].flatMap(([url, text]) => [addressBar(url!), observe(url!), readPage(url!, text!)]),
]);

describe("discoverReadings (from read_page output only)", () => {
  it("finds each reading's sections on its own page, in order, and leaves other readings out", () => {
    expect(
      discoverReadings(criterion(), grading).map((r) => [
        r.reading,
        r.sections.map((s) => s.title),
        r.problem,
      ]),
    ).toEqual([
      [1, ["1.1 Variables", "1.2 Types"], null],
      [2, ["2.1 Loops", "2.2 Functions"], null],
      [3, ["3.1 Overview", "3.2 Review"], null],
    ]);
  });
  it("also reads sections listed right after the reading's own entry on one page", () => {
    const grouped = traceOf([
      observe(INDEX),
      readLinks(INDEX, [
        { name: "Reading 1" },
        { name: "1.1 Variables", href: "/library/chapter/1/section/1" },
        { name: "Reading 2" },
        { name: "2.1 Loops", href: "/library/chapter/2/section/1" },
      ]),
    ]);
    const found = discoverReadings(criterion({ readings: [1, 2] }), grouped);
    expect(found.map((r) => r.sections.map((s) => s.url))).toEqual([
      [section(1, 1)],
      [section(2, 1)],
    ]);
  });
  it("names what it could not discover", () => {
    const partial = traceOf([
      observe(INDEX),
      readLinks(INDEX, [{ name: "Reading 1", href: "/library/reading/1" }]),
    ]);
    expect(
      discoverReadings(criterion({ readings: [1, 5] }), partial).map((r) => r.problem),
    ).toEqual([
      `the reading's page (${reading(1)}) was never read in interactive mode`,
      "reading 5 was not found in any read_page result",
    ]);
  });
});

describe("grading discovered readings, section by section", () => {
  it("passes, fails or marks each section unknown, with where and why; unknown never passes", () => {
    const verdict = evaluate(criterion(), null, grading);
    expect(verdict.sections!.map((s) => [s.title, s.outcome, s.reason])).toEqual([
      ["1.1 Variables", "passed", "2/2 activities complete"],
      ["1.2 Types", "passed", "1/1 activities complete"],
      ["2.1 Loops", "failed", "1/2 activities complete"],
      ["2.2 Functions", "passed", "2/2 activities complete"],
      ["3.1 Overview", "unknown", "no activity found on the page"],
      ["3.2 Review", "unknown", "never read in the grading run"],
    ]);
    expect(verdict.sections![2]!.url).toBe(section(2, 1));
    expect(verdict).toMatchObject({
      outcome: "partial",
      summary: "3/6 sections passed, 2 unknown",
    });
    expect(verdict.unmet).toEqual([
      "2.1 Loops: 1/2 activities complete",
      "3.1 Overview: no activity found on the page",
      "3.2 Review: never read in the grading run",
    ]);
  });
  it("fails when nothing could be discovered, never passing an empty book", () => {
    const verdict = evaluate(criterion(), null, traceOf([observe(INDEX)]));
    expect(verdict.outcome).toBe("failed");
    expect(verdict.sections!.every((s) => s.outcome === "unknown")).toBe(true);
  });
  it("needs the main run to have worked on every activity when interaction is required (redo)", () => {
    const click = computer({ type: "click", x: 5, y: 5, button: "left" });
    const main = traceOf([observe(section(1, 1)), click, click, observe(section(1, 2))]);
    const verdict = evaluate(criterion({ readings: [1], requireInteraction: true }), main, grading);
    expect(verdict.sections!.map((s) => [s.outcome, s.reason])).toEqual([
      ["passed", "2/2 activities complete, 2 interactions"],
      ["failed", "1/1 activities complete, but the main run worked on it 0 time(s), needs 1"],
    ]);
    expect(verdict.unvisited).toEqual([section(1, 2)]);
  });
});
