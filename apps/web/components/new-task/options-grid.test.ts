import { DEFAULT_BUDGET } from "@mastertutor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ids } from "@/lib/fixtures/ids.ts";
import { OptionsGrid } from "./options-grid.tsx";

const noop = () => undefined;
const render = (folderName: string) =>
  renderToStaticMarkup(
    createElement(OptionsGrid, {
      sources: [],
      domains: [],
      onDomains: noop,
      budget: "standard",
      onBudget: noop,
      standardBudget: DEFAULT_BUDGET,
      approvalMode: "ask",
      onApprovalMode: noop,
      bypassAcknowledged: false,
      onBypassAcknowledged: noop,
      folders: [{ id: ids.folder(1), parentId: null, name: folderName, sort: 0 }],
      folderId: null,
      onFolder: noop,
    }),
  );

describe("OptionsGrid: folder names are untrusted (M4, S6)", () => {
  it("cleans a folder name the agent created before it reaches the <option>", () => {
    const html = render("Courses‮​fdp.exe");
    expect(html).toContain(">Coursesfdp.exe</option>");
    expect(html).not.toContain("‮");
  });
});
