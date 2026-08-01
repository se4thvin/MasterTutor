import { describe, expect, it } from "vitest";
import {
  baselineCriterion,
  evaluate,
  finalOutcome,
  sameDocument,
  verifyTainted,
} from "./criteria.ts";
import { computer, fill, observe, readPage, traceOf } from "./trace-fixtures.ts";
import type { Criterion } from "./types.ts";

const click = computer({ type: "click", x: 5, y: 5, button: "left" });
const scroll = computer({ type: "scroll", x: 1, y: 1, scroll_x: 0, scroll_y: 300 });

describe("page_text", () => {
  const criterion: Criterion = {
    kind: "page_text",
    url: "http://bench.fixtures.test/book",
    mustMatch: ["3 of 3 activities completed \\(100%\\)"],
  };
  it("passes from one read_page result on the target page", () => {
    const verify = traceOf([
      observe("http://bench.fixtures.test/book?x=1"),
      readPage(
        "http://bench.fixtures.test/book?x=1",
        "Participation: 3 of 3 activities completed (100%)",
      ),
    ]);
    expect(evaluate(criterion, null, verify).outcome).toBe("passed");
  });
  it("fails without evidence, or with evidence from another page", () => {
    expect(evaluate(criterion, null, traceOf([])).outcome).toBe("failed");
    expect(evaluate(criterion, null, null).outcome).toBe("failed");
    const elsewhere = traceOf([
      observe("http://bench.fixtures.test/other"),
      readPage("http://bench.fixtures.test/other", "3 of 3 activities completed (100%)"),
    ]);
    expect(evaluate(criterion, null, elsewhere).outcome).toBe("failed");
  });
});

describe("sections_complete", () => {
  const s1 = "https://learn.example/book/chapter/1/section/1";
  const s2 = "https://learn.example/book/chapter/1/section/2";
  const criterion: Criterion = {
    kind: "sections_complete",
    sections: [
      { reading: 1, title: "1.1", url: s1 },
      { reading: 1, title: "1.2", url: s2 },
    ],
    activityPattern: "PARTICIPATION ACTIVITY",
    completedPattern: "Activity completed",
    requireInteraction: true,
  };
  const page = (n: number, done: number) =>
    `${"PARTICIPATION ACTIVITY ".repeat(n)}${"Activity completed ".repeat(done)}`;
  const verifyAll = traceOf([
    observe(s1),
    readPage(s1, page(2, 2)),
    observe(s2),
    readPage(s2, page(1, 1)),
  ]);

  it("passes when every section is complete and each activity was worked on", () => {
    const main = traceOf([observe(s1), click, click, observe(s2), click]);
    expect(evaluate(criterion, main, verifyAll)).toMatchObject({
      outcome: "passed",
      unvisited: [],
    });
  });
  it("is partial when a section only had scrolls: already complete is not enough (P10b-7)", () => {
    const main = traceOf([observe(s1), click, click, observe(s2), scroll, scroll]);
    expect(evaluate(criterion, main, verifyAll)).toMatchObject({
      outcome: "partial",
      unvisited: [s2],
    });
  });
  it("counts per single result, never summed across results (P10b-8)", () => {
    const split = traceOf([
      observe(s1),
      readPage(s1, page(2, 1)),
      readPage(s1, page(2, 1)),
      observe(s2),
      readPage(s2, page(1, 1)),
    ]);
    const main = traceOf([observe(s1), click, click, observe(s2), click]);
    expect(evaluate(criterion, main, split).outcome).toBe("partial");
  });
  it("counts zero activities as not complete", () => {
    const verify = traceOf([
      observe(s1),
      readPage(s1, "nothing"),
      observe(s2),
      readPage(s2, "nothing"),
    ]);
    expect(evaluate(baselineCriterion(criterion), null, verify).outcome).toBe("failed");
  });
  it("taints a grading run on any mutating action anywhere, except signing in (P10a-24, I3)", () => {
    const signin = "https://learn.example/signin";
    const work = "https://learn.example/book/chapter/1/section/1/activities";
    const type = computer({ type: "type", text: "42" });
    const key = computer({ type: "keypress", keys: ["ENTER"] });
    expect(verifyTainted(verifyAll, signin)).toBe(false);
    expect(verifyTainted(traceOf([observe(signin), click, type, key, observe(s1)]), signin)).toBe(
      false,
    );
    // Work done on a page that is not graded still taints: the fixtures' two-page layout.
    for (const act of [click, type, key])
      expect(
        verifyTainted(traceOf([observe(work), act, observe(s1), readPage(s1, page(2, 2))]), signin),
      ).toBe(true);
    expect(verifyTainted(traceOf([observe(s1), click, readPage(s1, page(2, 2))]), signin)).toBe(
      true,
    );
    // Without a declared sign-in page, nothing may be clicked at all.
    expect(verifyTainted(traceOf([observe(signin), click]), null)).toBe(true);
    // Scrolls and reads are not mutating.
    expect(verifyTainted(traceOf([observe(work), scroll, readPage(s1, page(2, 2))]), null)).toBe(
      false,
    );
  });
});

describe("signed_in, on the main trace (P10b-5)", () => {
  const criterion: Criterion = {
    kind: "signed_in",
    origin: "https://learn.example",
    signInPath: "/signin",
  };
  const signin = "https://learn.example/signin";
  it("passes when the agent filled two fields cleanly and ended on the origin, off the sign-in page", () => {
    const main = traceOf([observe(signin), fill(null), fill(null), click], {
      finalUrl: "https://learn.example/library",
    });
    expect(evaluate(criterion, main, null).outcome).toBe("passed");
  });
  it("fails on a credential error, on the sign-in page, off origin, or with no fills", () => {
    expect(
      evaluate(
        criterion,
        traceOf([observe(signin), fill(null), fill("frame_mismatch")], {
          finalUrl: "https://learn.example/library",
        }),
        null,
      ).outcome,
    ).toBe("failed");
    expect(
      evaluate(
        criterion,
        traceOf([observe(signin), fill(null), fill(null)], { finalUrl: signin }),
        null,
      ).outcome,
    ).toBe("failed");
    expect(
      evaluate(
        criterion,
        traceOf([observe(signin), fill(null), fill(null)], { finalUrl: "https://other.example/" }),
        null,
      ).outcome,
    ).toBe("failed");
    expect(
      evaluate(criterion, traceOf([], { finalUrl: "https://learn.example/library" }), null).outcome,
    ).toBe("failed");
    expect(evaluate(criterion, null, null).outcome).toBe("failed");
  });
});

describe("finalOutcome and sameDocument", () => {
  it("never passes a run that needed a takeover", () => {
    expect(finalOutcome({ outcome: "passed", summary: "", unmet: [], unvisited: [] }, 1)).toBe(
      "partial",
    );
    expect(finalOutcome({ outcome: "passed", summary: "", unmet: [], unvisited: [] }, 0)).toBe(
      "passed",
    );
  });
  it("ignores query, hash and trailing slash", () => {
    expect(sameDocument("https://a.b/x/?q=1#h", "https://a.b/x")).toBe(true);
    expect(sameDocument("https://a.b/x", "https://a.b/y")).toBe(false);
  });
});
