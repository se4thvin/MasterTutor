import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThoughtLine } from "./thought-line.tsx";

const render = (working: boolean) =>
  renderToStaticMarkup(
    createElement(ThoughtLine, {
      label: "Choosing what to capture next",
      working,
      since: "2026-10-05T17:09:47.000Z",
    }),
  );

describe("ThoughtLine", () => {
  it("isolates the model's label in <bdi> and speaks it once, politely", () => {
    const html = render(true);
    expect(html).toContain('<bdi class="tline-work">Choosing what to capture next</bdi>');
    expect(html).toContain(
      '<span class="sr-only" role="status">Choosing what to capture next</span>',
    );
    expect(html).toContain('data-working="true"');
  });

  it("hides the visual crossfade and the ticking timer from assistive technology", () => {
    const html = render(false);
    expect(html).not.toContain("data-working");
    expect(html).toContain('<span class="tline-glyph" aria-hidden="true">');
    expect(html).toContain('<span class="tline-labels" aria-hidden="true">');
    expect(html).toMatch(/<span class="tline-timer" aria-hidden="true">/);
    expect(html).toContain('<span class="tline-done">Thought for</span>');
  });
});
