import type { ReadPageResult } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { Criterion } from "./types.ts";

export interface Verdict {
  outcome: "passed" | "partial" | "failed";
  summary: string;
  unmet: string[];
  unvisited: string[];
}

export function sameDocument(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
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
  return criterion.kind === "sections_complete"
    ? { ...criterion, requireInteraction: false }
    : criterion;
}

/** A takeover is a failure for benchmarking: it caps the outcome at partial (the service caps it too). */
export function finalOutcome(verdict: Verdict, takeovers: number): Verdict["outcome"] {
  return takeovers > 0 && verdict.outcome === "passed" ? "partial" : verdict.outcome;
}
