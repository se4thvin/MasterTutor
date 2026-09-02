import { describe, expect, it } from "vitest";
import { evaluate } from "./criteria.ts";
import { discoverReadings } from "./discovery.ts";
import { addressBar, clickOn, observe, readLinks, readPage, traceOf } from "./trace-fixtures.ts";
import type { Criterion } from "./types.ts";

const SITE = "http://bench.fixtures.test:8080";
const INDEX = `${SITE}/library`;
const reading = (n: number) => `${SITE}/library/reading/${n}`;
const section = (r: number, m: number) => `${SITE}/library/chapter/${r}/section/${m}`;
type Discovered = Extract<Criterion, { kind: "discovered_readings" }>;
const criterion = (over: Partial<Discovered> = {}): Discovered => ({
  kind: "discovered_readings",
  readings: [1, 2, 3],
  readingPattern: "^Reading (\\d+)$",
  sectionUrlPattern: `^${SITE}/library/chapter/\\d+/section/\\d+$`,
  groupPattern: "^Chapter \\d+",
  activityPattern: "PARTICIPATION ACTIVITY (\\d+(?:\\.\\d+)+)",
  otherActivityPattern: "CHALLENGE ACTIVITY",
  completedPattern: "Activity completed",
  questionPattern: "(\\d+)\\)",
  stepPattern: "\\bStep (\\d+)\\b",
  stepControlPattern: "^(?:Start|Play step)\\b",
  requireInteraction: false,
  ...over,
});

/** A section's visible text, as read_page "text" returns it. */
const quiz = (id: string, questions: number, done: boolean) =>
  [
    `PARTICIPATION ACTIVITY ${id}: Quiz`,
    ...Array.from({ length: questions }, (_, i) => `${i + 1}) Question ${i + 1}`),
    done ? "Activity completed" : "Not started",
  ].join("\n");
const animation = (id: string, steps: number, done: boolean) =>
  [
    `PARTICIPATION ACTIVITY ${id}: Animation`,
    "Start",
    ...Array.from({ length: steps }, (_, i) => `Step ${i + 1}`),
    done ? "Activity completed" : "Not started",
  ].join("\n");
const challenge = (id: string) => `CHALLENGE ACTIVITY ${id}: Challenge\nActivity completed`;
const text = (...blocks: string[]) => blocks.join("\n");

const indexRead = readLinks(
  INDEX,
  [1, 2, 3, 4].map((n) => ({ name: `Reading ${n}`, href: `/library/reading/${n}` })),
);
const readingRead = (n: number, titles: string[]) =>
  readLinks(
    reading(n),
    titles.map((title, i) => ({ name: title, href: `/library/chapter/${n}/section/${i + 1}` })),
  );
const visit = (url: string, body: string) => [addressBar(url), observe(url), readPage(url, body)];

describe("discoverReadings: only from listings it can prove complete (I1)", () => {
  const base = [
    observe(INDEX),
    indexRead,
    addressBar(reading(1)),
    observe(reading(1)),
    readingRead(1, ["1.1 Variables", "1.2 Types"]),
  ];

  it("finds each reading's sections on its own page, in order, and leaves other readings out", () => {
    const found = discoverReadings(criterion({ readings: [1] }), traceOf(base));
    expect(found.map((r) => [r.reading, r.sections.map((s) => s.title), r.problem])).toEqual([
      [1, ["1.1 Variables", "1.2 Types"], null],
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

  it("does not trust a listing the 400-element cap truncated, but does once it was paged through", () => {
    const links = Array.from({ length: 452 }, (_, i) => ({
      name: `${1}.${i + 1} S`,
      href: `/library/chapter/1/section/${i + 1}`,
    }));
    const truncated = traceOf([
      observe(reading(1)),
      indexRead,
      readLinks(reading(1), links.slice(0, 400), { total: 452 }),
    ]);
    expect(discoverReadings(criterion({ readings: [1] }), truncated)[0]!.problem).toBe(
      `the listing on ${reading(1)} is incomplete: 400 of 452 elements were read (page through with offset)`,
    );
    const paged = traceOf([
      observe(reading(1)),
      indexRead,
      readLinks(reading(1), links.slice(0, 400), { total: 452, offset: 0 }),
      readLinks(reading(1), links.slice(400), { total: 452, offset: 400 }),
    ]);
    const found = discoverReadings(criterion({ readings: [1] }), paged)[0]!;
    expect([found.problem, found.sections.length]).toEqual([null, 452]);
  });

  it("does not trust a listing with a chapter still collapsed, but does once it was expanded", () => {
    const collapsed = readLinks(reading(3), [
      { name: "3.1 Overview", href: "/library/chapter/3/section/1" },
      { name: "Chapter 3 more [collapsed]" },
    ]);
    const expanded = readLinks(reading(3), [
      { name: "3.1 Overview", href: "/library/chapter/3/section/1" },
      { name: "Chapter 3 more [expanded]" },
      { name: "3.3 Extra", href: "/library/chapter/3/section/3" },
    ]);
    const before = traceOf([observe(INDEX), indexRead, observe(reading(3)), collapsed]);
    expect(discoverReadings(criterion({ readings: [3] }), before)[0]!.problem).toBe(
      `the listing on ${reading(3)} is incomplete: a collapsed group ("Chapter 3 more") was never expanded`,
    );
    const after = traceOf([
      observe(INDEX),
      indexRead,
      observe(reading(3)),
      collapsed,
      clickOn("Chapter 3 more", []),
      expanded,
    ]);
    expect(
      discoverReadings(criterion({ readings: [3] }), after)[0]!.sections.map((s) => s.title),
    ).toEqual(["3.1 Overview", "3.3 Extra"]);
  });

  it("does not trust a listing that does not say how many elements it has (rows from before)", () => {
    const old = traceOf([
      observe(INDEX),
      indexRead,
      observe(reading(1)),
      readLinks(reading(1), [{ name: "1.1 Variables", href: "/library/chapter/1/section/1" }], {}),
    ]);
    expect(discoverReadings(criterion({ readings: [1] }), old)[0]!.problem).toBe(
      `the listing on ${reading(1)} is incomplete: it does not say how many elements the page has`,
    );
  });

  it("names a reading it could not find, and a reading page it never read", () => {
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

describe("grading each section per activity", () => {
  const grading = traceOf([
    observe(INDEX),
    indexRead,
    addressBar(reading(1)),
    observe(reading(1)),
    readingRead(1, ["1.1 Variables", "1.2 Types", "1.3 Loops", "1.4 Overview"]),
    ...visit(section(1, 1), text(quiz("1.1.1", 2, true), animation("1.1.2", 2, true))),
    ...visit(section(1, 2), text(quiz("1.2.1", 1, true))),
    // I2: a first read before the activities rendered, then the full one.
    ...visit(section(1, 3), text(quiz("1.3.1", 1, true))),
    readPage(
      section(1, 3),
      text(quiz("1.3.1", 1, true), quiz("1.3.2", 1, false), challenge("1.3.3")),
    ),
    ...visit(section(1, 4), "An overview with no activities."),
  ]);
  const at = (n: number, id: string, extra: string[] = []) => [
    ...extra,
    `PARTICIPATION ACTIVITY ${id}: Quiz or animation`,
    "Section",
  ];
  const main = traceOf([
    observe(section(1, 1)),
    clickOn("Yes", at(1, "1.1.1", ["1) Question 1 Yes No"])),
    clickOn("No", at(1, "1.1.1", ["2) Question 2 Yes No"])),
    clickOn("Start", at(1, "1.1.2", ["Start Step 1 Step 2 Play step"])),
    clickOn("Play step", at(1, "1.1.2", ["Start Step 1 Step 2 Play step"])),
    observe(section(1, 2)),
    clickOn("Next section", ["Next section", "Section"]),
  ]);

  it("passes only an activity whose every question was answered and every step played by the main run (I3)", () => {
    const verdict = evaluate(criterion({ readings: [1], requireInteraction: true }), main, grading);
    expect(verdict.sections!.map((s) => [s.title, s.outcome, s.reason])).toEqual([
      [
        "1.1 Variables",
        "passed",
        "2/2 activities complete, every question answered and every animation step played",
      ],
      [
        "1.2 Types",
        "failed",
        "1/1 activities complete, but activity 1.2.1: answered 0/1 questions",
      ],
      ["1.3 Loops", "failed", "1/2 activities complete"],
      ["1.4 Overview", "unknown", "no activity found on the page"],
    ]);
    expect(verdict.unvisited).toEqual([section(1, 2)]);
    expect(verdict.outcome).toBe("partial");
  });

  it("counts a played animation only with every step played, and a quiz only with every question answered", () => {
    const half = traceOf([
      observe(section(1, 1)),
      clickOn("Yes", at(1, "1.1.1", ["1) Question 1 Yes No"])),
      clickOn("Start", at(1, "1.1.2", ["Start Step 1 Step 2 Play step"])),
    ]);
    const [first] = evaluate(
      criterion({ readings: [1], requireInteraction: true }),
      half,
      grading,
    ).sections!;
    expect(first!.reason).toBe(
      "2/2 activities complete, but activity 1.1.1: answered 1/2 questions",
    );
  });

  it("grades on the fullest read and counts participation activities only, never challenge ones (I2)", () => {
    const verdict = evaluate(criterion({ readings: [1] }), null, grading);
    expect(verdict.sections!.find((s) => s.title === "1.3 Loops")!.reason).toBe(
      "1/2 activities complete",
    );
  });

  it("checks completion only for a baseline (no interaction required)", () => {
    const verdict = evaluate(criterion({ readings: [1] }), null, grading);
    expect(verdict.sections!.map((s) => s.outcome)).toEqual([
      "passed",
      "passed",
      "failed",
      "unknown",
    ]);
  });

  it("marks a reading unknown when its listing cannot be confirmed complete, and unknown never passes", () => {
    const verdict = evaluate(criterion({ readings: [1, 2] }), null, grading);
    expect(verdict.sections!.at(-1)).toMatchObject({ reading: 2, outcome: "unknown" });
    expect(verdict.outcome).toBe("partial");
    expect(evaluate(criterion(), null, traceOf([observe(INDEX)])).outcome).toBe("failed");
  });
});
