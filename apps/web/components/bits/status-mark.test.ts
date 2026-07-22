import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusMark } from "./status-mark.tsx";

describe("StatusMark", () => {
  it("speaks its status as an image by default", () => {
    const html = renderToStaticMarkup(createElement(StatusMark, { status: "done" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Completed"');
    expect(html).toContain('data-status="done"');
  });
  it("takes a custom label", () => {
    const html = renderToStaticMarkup(
      createElement(StatusMark, { status: "pending", label: "Signs in on next use" }),
    );
    expect(html).toContain('aria-label="Signs in on next use"');
  });
  it("is hidden when decorative (text beside it says the same)", () => {
    const html = renderToStaticMarkup(
      createElement(StatusMark, { status: "running", decorative: true }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });
});
