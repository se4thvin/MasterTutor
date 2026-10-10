import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CaptureBrief } from "@mastertutor/contracts";
import { BriefEditor, toggleCaptureChoice } from "./brief-editor.tsx";
const brief: CaptureBrief = {
  keep: ["reading_text"],
  skip: ["due_dates"],
  scopeNote: "Read the lesson.",
};
it("moving a category to Keep removes it from Skip, and deselection preserves the scope note", () => {
  const moved = toggleCaptureChoice(brief, "keep", "due_dates");
  expect(moved.keep).toEqual(["reading_text", "due_dates"]);
  expect(moved.skip).toEqual([]);
  expect(CaptureBrief.safeParse(moved).success).toBe(true);
  expect(toggleCaptureChoice(moved, "keep", "due_dates")).toEqual({ ...brief, skip: [] });
});
it("uses labeled multi-select buttons and an escaped, bounded scope field on a solid content surface", () => {
  const html = renderToStaticMarkup(
    createElement(BriefEditor, {
      brief: { ...brief, scopeNote: "<script>" },
      onSave: async () => {},
      submitLabel: "Continue",
    }),
  );
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Scope note");
  expect(html).toContain('maxLength="500"');
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("glass");
});
