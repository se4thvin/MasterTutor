import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./icon.tsx";
import { SOURCE_KIND_ICON, icons, type IconName } from "./icons.ts";

const REQUIRED: IconName[] = [
  // source and type
  "web",
  "pdf",
  "video",
  // folders
  "folder",
  "folderOpen",
  "folderNested",
  "folderAdd",
  "unfiled",
  "allNotes",
  // status
  "verified",
  "partial",
  "needsReview",
  "edited",
  "agentNote",
  "live",
  // vault fields
  "username",
  "password",
  "totp",
  "pin",
  "emailOtp",
  "codeOtp",
  "passkey",
  "hidden",
  // actions
  "add",
  "search",
  "close",
  "more",
  "move",
  "delete",
  "export",
  "edit",
  "check",
  "undo",
  "external",
  "signOut",
  "stop",
];

describe("icon registry (spec §11.3)", () => {
  it("covers every required set", () => {
    for (const name of REQUIRED) expect(icons, name).toHaveProperty(name);
  });

  it("maps every source kind to an icon, never a letter tile", () => {
    expect(SOURCE_KIND_ICON).toEqual({ web: "web", pdf: "pdf", youtube: "video" });
  });

  it("renders decorative icons hidden with a 1.6 stroke", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "folder" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke-width="1.6"');
    expect(html).toContain("ic ic-md");
  });

  it("names labelled icons", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "verified", label: "Verified" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Verified"');
    expect(html).not.toContain("aria-hidden");
  });
});
