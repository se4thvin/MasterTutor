import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentCursor } from "./agent-cursor.tsx";

const render = (props: Partial<Parameters<typeof AgentCursor>[0]>) =>
  renderToStaticMarkup(
    createElement(AgentCursor, {
      target: { x: 120, y: 80 },
      pulseKey: null,
      hidden: false,
      thinking: false,
      ...props,
    }),
  );

describe("AgentCursor", () => {
  it("is decorative: the whole layer is hidden from assistive technology", () => {
    expect(render({})).toMatch(/^<div class="acur-layer" aria-hidden="true">/);
  });

  it("hides itself without a target or when asked, and drifts only while thinking", () => {
    expect(render({ target: null })).toContain('class="acur" data-hidden="true"');
    expect(render({ hidden: true })).toContain('class="acur" data-hidden="true"');
    expect(render({})).not.toContain("data-hidden");
    expect(render({ thinking: true })).toContain('class="acur-drift" data-thinking="true"');
  });

  it("plays the click ring only for a pointer step it can see", () => {
    expect(render({ pulseKey: 10 })).toContain('data-testid="click-pulse"');
    expect(render({ pulseKey: 10 })).toContain("left:120px;top:80px");
    expect(render({ pulseKey: null })).not.toContain("click-pulse");
    expect(render({ pulseKey: 10, hidden: true })).not.toContain("click-pulse");
  });
});
