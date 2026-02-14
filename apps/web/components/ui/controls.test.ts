import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";
import { IconButton } from "./button.tsx";
import { PageHead } from "./page-head.tsx";
import { TextField } from "./text-field.tsx";

describe("controls", () => {
  it("names icon-only buttons", () => {
    const html = renderToStaticMarkup(
      createElement(IconButton, { icon: "more", label: "More actions" }),
    );
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain('type="button"');
  });

  it("pairs every badge colour with an icon and a word", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { tone: "warn", icon: "needsReview", children: "Needs review" }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("Needs review");
    expect(html).toContain("badge-warn");
  });

  it("links text fields to their label, hint and error", () => {
    const html = renderToStaticMarkup(
      createElement(TextField, { id: "alias", label: "Alias", hint: "Lowercase", error: "Taken" }),
    );
    expect(html).toContain('for="alias"');
    expect(html).toContain('aria-describedby="alias-hint alias-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it("ends page titles with a decorative signal period", () => {
    const html = renderToStaticMarkup(createElement(PageHead, { title: "Library" }));
    expect(html).toMatch(/Library<span class="period" aria-hidden="true">\.<\/span>/);
  });
});
