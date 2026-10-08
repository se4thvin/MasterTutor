// Section discovery for the full-task benchmark (run 1): the grading run finds the readings and
// their sections, and this reads them back from its recorded read_page output only.
import type { ReadPageElement } from "@mastertutor/contracts";
import { sameDocument } from "./url.ts";
import type { RunTrace } from "./evidence.ts";
import type { Criterion } from "./types.ts";

export type DiscoveredReadingsCriterion = Extract<Criterion, { kind: "discovered_readings" }>;

export interface DiscoveredReading {
  reading: number;
  /** The reading's own page, when its entry links to one. */
  page: string | null;
  sections: { title: string; url: string }[];
  /** Why no section could be found, else null. */
  problem: string | null;
}

const absolute = (href: string | undefined, base: string): string | null => {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
};

export function discoverReadings(
  c: DiscoveredReadingsCriterion,
  trace: RunTrace,
): DiscoveredReading[] {
  const pages = trace.steps.flatMap((s) =>
    s.readPage !== null && "elements" in s.readPage ? [s.readPage] : [],
  );
  const readingOf = (el: ReadPageElement) => {
    const match = new RegExp(c.readingPattern, "iu").exec(el.name.trim());
    return match ? Number(match[1]) : null;
  };
  const isSection = (url: string | null): url is string =>
    url !== null && new RegExp(c.sectionUrlPattern, "u").test(url);

  return c.readings.map((n): DiscoveredReading => {
    let found = false;
    let page: string | null = null;
    const sections: { title: string; url: string }[] = [];
    const add = (title: string, url: string) => {
      if (!sections.some((s) => sameDocument(s.url, url)))
        sections.push({ title: title.trim(), url });
    };
    for (const result of pages) {
      let current: number | null = null;
      for (const el of result.elements) {
        const href = absolute(el.attrs.href, result.url);
        const reading = readingOf(el);
        if (reading !== null) {
          current = reading;
          if (reading === n) {
            found = true;
            if (href !== null && !isSection(href)) page ??= href;
          }
        } else if (current === n && isSection(href)) add(el.name, href);
      }
    }
    if (page !== null)
      for (const result of pages.filter((p) => sameDocument(p.url, page!)))
        for (const el of result.elements) {
          const href = absolute(el.attrs.href, result.url);
          if (isSection(href)) add(el.name, href);
        }
    const read = page !== null && pages.some((p) => sameDocument(p.url, page!));
    const problem =
      sections.length > 0
        ? null
        : !found
          ? `reading ${n} was not found in any read_page result`
          : page !== null && !read
            ? `the reading's page (${page}) was never read in interactive mode`
            : `no section links were listed for reading ${n}`;
    return { reading: n, page, sections, problem };
  });
}

/** A URL prefix as a literal regular expression, for section URL patterns in suite config. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
