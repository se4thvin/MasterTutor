/** Isolated-world functions; each must stay self-contained. */
export function pageForceEager(): number {
  let changed = 0;
  for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) {
    el.setAttribute("loading", "eager");
    changed++;
  }
  return changed;
}

export function pageScrollMetrics(): { x: number; y: number; height: number; viewport: number } {
  const root = document.scrollingElement ?? document.documentElement;
  return { x: scrollX, y: scrollY, height: root.scrollHeight, viewport: innerHeight };
}

export function pageScrollTo(x: number, y: number): void {
  scrollTo({ left: x, top: y, behavior: "instant" });
}

export function pageContentType(): string {
  return document.contentType;
}
