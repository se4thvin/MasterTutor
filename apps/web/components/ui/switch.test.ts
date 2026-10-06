import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch.tsx";

const render = (props: { disabled?: boolean; busy?: boolean }) =>
  renderToStaticMarkup(
    createElement(Switch, {
      checked: false,
      onCheckedChange: () => undefined,
      label: "X",
      ...props,
    }),
  );

describe("Switch", () => {
  it("says it is unavailable when disabled (M-2: busy must not erase it)", () => {
    expect(render({ disabled: true })).toContain('aria-disabled="true"');
  });
  it("says it is unavailable and busy while a change is in flight", () => {
    const html = render({ busy: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
  });
  it("is plainly available otherwise", () => {
    expect(render({})).not.toContain("aria-disabled");
  });
});
