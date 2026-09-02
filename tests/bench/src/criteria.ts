import type { ReadPageResult } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { Criterion } from "./types.ts";
import { sameDocument } from "./url.ts";
import { discoverReadings, type DiscoveredReadingsCriterion } from "./discovery.ts";

/** One discovered section's grade: where it is and why it got that outcome. Unknown never passes. */
export interface SectionOutcome {
  reading: number;
  title: string;
  url: string | null;
  outcome: "passed" | "failed" | "unknown";
  reason: string;
}

export interface Verdict {
  outcome: "passed" | "partial" | "failed";
  summary: string;
  unmet: string[];
  unvisited: string[];
  /** Per-section grades, for criteria graded section by section from discovery. */
  sections?: SectionOutcome[];
}

function flatten(result: Exclude<ReadPageResult, { unchanged: true }>): string {
  if ("text" in result) return result.text;
  return result.elements.map((e) => [e.name, ...Object.values(e.attrs)].join(" ")).join("\n");
}

/** One text per read_page result on that document: results are never merged (P10b-8). */
export function evidenceResults(trace: RunTrace, url: string): string[] {
  return trace.steps.flatMap((s) =>
    s.readPage !== null && !("unchanged" in s.readPage) && sameDocument(s.readPage.url, url)
      ? [flatten(s.readPage)]
      : [],
  );
}

const count = (text: string, pattern: string) =>
  (text.match(new RegExp(pattern, "giu")) ?? []).length;
const failed = (summary: string, unmet: string[] = []): Verdict => ({
  outcome: "failed",
  summary,
  unmet,
  unvisited: [],
});
const originOf = (url: string | null) => {
  try {
    return url === null ? null : new URL(url).origin;
  } catch {
    return null;
  }
};

const pathOf = (url: string | null) => {
  try {
    return url === null ? "" : new URL(url).pathname;
  } catch {
    return "";
  }
};

function interactionsOn(trace: RunTrace | null, url: string): number {
  return (
    trace?.steps.filter((s) => s.interaction && s.url !== null && sameDocument(s.url, url))
      .length ?? 0
  );
}

export function evaluate(
  criterion: Criterion,
  main: RunTrace | null,
  verify: RunTrace | null,
): Verdict {
  if (criterion.kind === "signed_in") {
    if (main === null) return failed("no main run trace");
    const fills = main.steps.filter(
      (s) => s.tool === "fill_credential" && s.phase === "act" && s.state === "done",
    );
    const unmet = [
      ...(main.status === "completed" ? [] : [`run ended ${main.status}`]),
      ...(fills.length >= 2 ? [] : [`${fills.length} credential fill(s), expected at least 2`]),
      ...fills
        .filter((s) => s.credentialError !== null)
        .map((s) => `fill_credential error ${s.credentialError} at step ${s.seq}`),
      ...(originOf(main.finalUrl) === criterion.origin ? [] : ["ended off the site's origin"]),
      ...(pathOf(main.finalUrl).startsWith(criterion.signInPath)
        ? ["ended on the sign-in page"]
        : []),
    ];
    return {
      outcome: unmet.length === 0 ? "passed" : "failed",
      summary: unmet.length === 0 ? "signed in" : "not signed in",
      unmet,
      unvisited: [],
    };
  }
  if (verify === null) return failed("no verify run evidence");
  if (criterion.kind === "discovered_readings") return evaluateDiscovered(criterion, main, verify);
  if (criterion.kind === "page_text") {
    const results = evidenceResults(verify, criterion.url);
    if (results.length === 0)
      return failed("no read_page evidence for the target page", [...criterion.mustMatch]);
    const misses = results.map((text) =>
      criterion.mustMatch.filter((p) => !new RegExp(p, "u").test(text)),
    );
    const best = misses.reduce((a, b) => (b.length < a.length ? b : a));
    return {
      outcome: best.length === 0 ? "passed" : "failed",
      summary: `${criterion.mustMatch.length - best.length}/${criterion.mustMatch.length} checks in one result`,
      unmet: best,
      unvisited: [],
    };
  }
  const unmet: string[] = [];
  const unvisited: string[] = [];
  let passed = 0;
  for (const section of criterion.sections) {
    const counts = evidenceResults(verify, section.url).map((text) => ({
      activities: count(text, criterion.activityPattern),
      completed: count(text, criterion.completedPattern),
    }));
    const best = counts.reduce(
      (a, b) => (b.activities > 0 && b.completed >= b.activities ? b : a),
      counts[0] ?? { activities: 0, completed: 0 },
    );
    const complete = best.activities > 0 && best.completed >= best.activities;
    const acts = interactionsOn(main, section.url);
    const interacted = !criterion.requireInteraction || acts >= Math.max(1, best.activities);
    if (criterion.requireInteraction && acts === 0) unvisited.push(section.url);
    if (complete && interacted) passed++;
    else
      unmet.push(
        `${section.title}: ${best.completed}/${best.activities} complete, ${acts} interactions`,
      );
  }
  const total = criterion.sections.length;
  return {
    outcome: passed === total ? "passed" : passed === 0 ? "failed" : "partial",
    summary: `${passed}/${total} sections`,
    unmet,
    unvisited,
  };
}

/** One participation activity in a section's text (I2): challenge activities end a block, never count. */
interface ActivityBlock {
  id: string;
  complete: boolean;
  questions: Set<string>;
  steps: Set<string>;
}

function activityBlocks(text: string, c: DiscoveredReadingsCriterion): ActivityBlock[] {
  const headers = [
    ...[...text.matchAll(new RegExp(c.activityPattern, "giu"))].map((m) => ({
      at: m.index,
      id: m[1] ?? null,
    })),
    ...[...text.matchAll(new RegExp(c.otherActivityPattern, "giu"))].map((m) => ({
      at: m.index,
      id: undefined,
    })),
  ].sort((a, b) => a.at - b.at);
  const blocks: ActivityBlock[] = [];
  headers.forEach((header, i) => {
    if (header.id === undefined) return; // a challenge activity
    const body = text.slice(header.at, headers[i + 1]?.at ?? text.length);
    const ids = (pattern: string, flags: string) =>
      new Set([...body.matchAll(new RegExp(pattern, flags))].map((m, k) => m[1] ?? String(k + 1)));
    blocks.push({
      id: header.id ?? `#${blocks.length + 1}`,
      complete: new RegExp(c.completedPattern, "iu").test(body),
      questions: ids(`(?:^|\\n)[ \\t]*(?:${c.questionPattern})`, "giu"),
      steps: ids(c.stepPattern, "giu"),
    });
  });
  return blocks;
}

/** Which activity, and which question in it, an input landed in: from its recorded enclosing text. */
function placeOf(
  ancestors: readonly string[],
  c: DiscoveredReadingsCriterion,
): { activity: string; question: string | null } | null {
  const activity = new RegExp(`^\\s*(?:${c.activityPattern})`, "iu");
  const question = new RegExp(`^\\s*(?:${c.questionPattern})`, "iu");
  let inQuestion: string | null = null;
  for (const text of ancestors) {
    const a = activity.exec(text);
    if (a) return { activity: a[1] ?? "", question: inQuestion };
    const q = question.exec(text);
    if (q && inQuestion === null) inQuestion = q[1] ?? "";
  }
  return null;
}

function evaluateDiscovered(
  criterion: DiscoveredReadingsCriterion,
  main: RunTrace | null,
  verify: RunTrace,
): Verdict {
  const rows: SectionOutcome[] = [];
  const unvisited: string[] = [];
  const stepControl = new RegExp(criterion.stepControlPattern, "iu");
  for (const found of discoverReadings(criterion, verify)) {
    if (found.problem !== null) {
      rows.push({
        reading: found.reading,
        title: `Reading ${found.reading}`,
        url: found.page,
        outcome: "unknown",
        reason: found.problem,
      });
      continue;
    }
    for (const section of found.sections) {
      const grade = (outcome: SectionOutcome["outcome"], reason: string) =>
        rows.push({
          reading: found.reading,
          title: section.title,
          url: section.url,
          outcome,
          reason,
        });
      const results = evidenceResults(verify, section.url);
      if (results.length === 0) {
        grade("unknown", "never read in the grading run");
        continue;
      }
      // The fullest single read (I2): most activities, then most complete; never merged (P10b-8).
      const blocks = results
        .map((text) => activityBlocks(text, criterion))
        .reduce((a, b) => {
          const done = (x: ActivityBlock[]) => x.filter((block) => block.complete).length;
          return b.length > a.length || (b.length === a.length && done(b) > done(a)) ? b : a;
        });
      if (blocks.length === 0) {
        grade("unknown", "no activity found on the page");
        continue;
      }
      const complete = blocks.filter((block) => block.complete).length;
      const done = `${complete}/${blocks.length} activities complete`;
      if (complete < blocks.length) {
        grade("failed", done);
        continue;
      }
      if (!criterion.requireInteraction) {
        grade("passed", done);
        continue;
      }
      // I3: the account starts complete, so a pass needs the main run's own work on every question
      // and every animation step of every activity, tied to them by where each input landed.
      const inputs = (main?.steps ?? [])
        .filter((step) => step.url !== null && sameDocument(step.url, section.url))
        .flatMap((step) => step.actions.filter((a) => a.effect === "input" && a.target !== null))
        .flatMap((a) => {
          const place = placeOf(a.target!.ancestors, criterion);
          return place ? [{ ...place, step: stepControl.test(a.target!.label) }] : [];
        });
      if (inputs.length === 0) unvisited.push(section.url);
      let verdict: [SectionOutcome["outcome"], string] = [
        "passed",
        `${done}, every question answered and every animation step played`,
      ];
      for (const block of blocks) {
        const mine = inputs.filter((input) => input.activity === block.id);
        const answered = new Set(
          mine.flatMap((input) =>
            input.question !== null && block.questions.has(input.question) ? [input.question] : [],
          ),
        );
        const played = mine.filter((input) => input.step).length;
        if (block.questions.size + block.steps.size === 0) {
          verdict = ["unknown", `activity ${block.id}: no question or animation step found`];
          break;
        }
        if (answered.size < block.questions.size) {
          verdict = [
            "failed",
            `${done}, but activity ${block.id}: answered ${answered.size}/${block.questions.size} questions`,
          ];
          break;
        }
        if (played < block.steps.size) {
          verdict = [
            "failed",
            `${done}, but activity ${block.id}: played ${played}/${block.steps.size} animation steps`,
          ];
          break;
        }
      }
      grade(...verdict);
    }
  }
  const passed = rows.filter((r) => r.outcome === "passed").length;
  const unknown = rows.filter((r) => r.outcome === "unknown").length;
  return {
    outcome:
      rows.length > 0 && passed === rows.length ? "passed" : passed > 0 ? "partial" : "failed",
    summary: `${passed}/${rows.length} sections passed, ${unknown} unknown`,
    unmet: rows.filter((r) => r.outcome !== "passed").map((r) => `${r.title}: ${r.reason}`),
    unvisited,
    sections: rows,
  };
}

/**
 * A grading (verify) run must only read (P10a-24, I3): any click, type or key press on any page
 * taints it, so it cannot do the work on a page that is not graded. The one exception is the
 * declared sign-in page, which a fresh-login run must fill and submit.
 */
export function verifyTainted(verify: RunTrace, signInUrl: string | null): boolean {
  return verify.steps.some(
    (s) =>
      s.interaction && (signInUrl === null || s.url === null || !sameDocument(s.url, signInUrl)),
  );
}

/** D32 baseline: the pages already show completion; no interaction is expected from a verify run. */
export function baselineCriterion(criterion: Criterion): Criterion {
  return criterion.kind === "sections_complete" || criterion.kind === "discovered_readings"
    ? { ...criterion, requireInteraction: false }
    : criterion;
}

/** A takeover is a failure for benchmarking: it caps the outcome at partial (the service caps it too). */
export function finalOutcome(verdict: Verdict, takeovers: number): Verdict["outcome"] {
  return takeovers > 0 && verdict.outcome === "passed" ? "partial" : verdict.outcome;
}
