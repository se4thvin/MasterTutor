// Section discovery for the full-task benchmark (run 1): the grading run finds the readings and
// their sections, and this reads them back from its recorded read_page output only. A listing is
// used only when it is provably complete (I1): untruncated or paged through, nothing collapsed.
import type { ReadPageElement } from "@mastertutor/contracts";
import type { RunTrace } from "./evidence.ts";
import type { Criterion } from "./types.ts";
import { documentKey, sameDocument } from "./url.ts";

export type DiscoveredReadingsCriterion = Extract<Criterion, { kind: "discovered_readings" }>;

export interface DiscoveredReading {
  reading: number;
  /** The reading's own page, when its entry links to one. */
  page: string | null;
  sections: { title: string; url: string }[];
  /** Why the reading cannot be graded (not found, or a listing not confirmed complete), else null. */
  problem: string | null;
}

/** A document's latest complete view of its interactive elements, or why there is none. */
interface Listing {
  url: string;
  elements: ReadPageElement[];
  problem: string | null;
}

const STATE = / \[([^\]]*)\]$/;
const absolute = (href: string | undefined, base: string): string | null => {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
};

type Interactive = Extract<RunTrace["steps"][number]["readPage"], { elements: unknown }>;

/** The newest full view of one document: an untruncated read, or document-order pages covering it. */
function latestView(results: readonly Interactive[]): {
  elements: ReadPageElement[];
  problem: string | null;
} {
  const last = results.at(-1)!;
  if (last.total === undefined)
    return { elements: last.elements, problem: "it does not say how many elements the page has" };
  if (last.offset === undefined && last.elements.length >= last.total)
    return { elements: last.elements, problem: null };
  // Paged reads of the same page (same total), newest first, until [0, total) is covered.
  const pages = new Map<number, ReadPageElement[]>();
  for (const result of [...results].reverse()) {
    if (result.total !== last.total) break;
    if (result.offset !== undefined && !pages.has(result.offset))
      pages.set(result.offset, result.elements);
  }
  const elements: ReadPageElement[] = [];
  let next = 0;
  for (const [offset, slice] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    if (offset > next) break;
    elements.push(...slice.slice(next - offset));
    next = Math.max(next, offset + slice.length);
  }
  if (next >= last.total) return { elements, problem: null };
  const read = Math.max(next, last.elements.length);
  return {
    elements: last.elements,
    problem: `${read} of ${last.total} elements were read (page through with offset)`,
  };
}

function listings(c: DiscoveredReadingsCriterion, trace: RunTrace): Map<string, Listing> {
  const byDocument = new Map<string, { url: string; results: Interactive[] }>();
  for (const step of trace.steps) {
    const result = step.readPage;
    if (result === null || !("elements" in result)) continue;
    const key = documentKey(result.url);
    const entry = byDocument.get(key) ?? { url: result.url, results: [] };
    entry.results.push(result);
    byDocument.set(key, entry);
  }
  const group = new RegExp(c.groupPattern, "iu");
  const out = new Map<string, Listing>();
  for (const [key, { url, results }] of byDocument) {
    const view = latestView(results);
    const collapsed = view.elements.find((el) => {
      const state = STATE.exec(el.name);
      return (
        state?.[1]?.split(", ").includes("collapsed") && group.test(el.name.replace(STATE, ""))
      );
    });
    const problem =
      view.problem ??
      (collapsed
        ? `a collapsed group ("${collapsed.name.replace(STATE, "")}") was never expanded`
        : null);
    out.set(key, { url, elements: view.elements, problem });
  }
  return out;
}

export function discoverReadings(
  c: DiscoveredReadingsCriterion,
  trace: RunTrace,
): DiscoveredReading[] {
  const docs = listings(c, trace);
  const readingOf = (el: ReadPageElement) => {
    const match = new RegExp(c.readingPattern, "iu").exec(el.name.replace(STATE, "").trim());
    return match ? Number(match[1]) : null;
  };
  const isSection = (url: string | null): url is string =>
    url !== null && new RegExp(c.sectionUrlPattern, "u").test(url);

  return c.readings.map((n): DiscoveredReading => {
    let found = false;
    let page: string | null = null;
    const sections: { title: string; url: string }[] = [];
    const problems: string[] = [];
    const add = (title: string, url: string) => {
      if (!sections.some((s) => sameDocument(s.url, url)))
        sections.push({ title: title.replace(STATE, "").trim(), url });
    };
    for (const listing of docs.values()) {
      let current: number | null = null;
      let contributed = false;
      for (const el of listing.elements) {
        const href = absolute(el.attrs.href, listing.url);
        const reading = readingOf(el);
        if (reading !== null) {
          current = reading;
          if (reading === n) {
            found = true;
            if (href !== null && !isSection(href)) page ??= href;
          }
        } else if (current === n && isSection(href)) {
          add(el.name, href);
          contributed = true;
        }
      }
      if (contributed && listing.problem)
        problems.push(`the listing on ${listing.url} is incomplete: ${listing.problem}`);
    }
    if (page !== null) {
      const own = docs.get(documentKey(page));
      if (!own) problems.push(`the reading's page (${page}) was never read in interactive mode`);
      else {
        for (const el of own.elements) {
          const href = absolute(el.attrs.href, own.url);
          if (isSection(href)) add(el.name, href);
        }
        if (own.problem) problems.push(`the listing on ${own.url} is incomplete: ${own.problem}`);
      }
    }
    const problem =
      problems[0] ??
      (sections.length > 0
        ? null
        : found
          ? `no section links were listed for reading ${n}`
          : `reading ${n} was not found in any read_page result`);
    return { reading: n, page, sections, problem };
  });
}

/** A URL prefix as a literal regular expression, for section URL patterns in suite config. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
