import { OBSERVE_UI_SESSION } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { enterPage, handoffPage } from "./pages.ts";

describe("enterPage (spec §12, B1: OpenObserve v1.0.4's userInfo record)", () => {
  it("seeds OpenObserve's identity record (no secret) and goes to the UI", () => {
    const html = enterPage();
    const record = Buffer.from(JSON.stringify(OBSERVE_UI_SESSION.identity)).toString("base64");
    expect(html).toContain(`localStorage.setItem("userInfo",${JSON.stringify(record)})`);
    expect(html).toContain('location.replace("/observability/web/")');
    expect(html).not.toMatch(/password|Basic /i);
  });

  it("writes the record OpenObserve reads back: base64 of the identity JSON", () => {
    const value = /setItem\("userInfo","([^"]+)"\)/.exec(enterPage())![1]!;
    expect(JSON.parse(Buffer.from(value, "base64").toString("utf8"))).toEqual({
      email: "viewer@mastertutor.internal",
      name: "Owner",
      role: "admin",
    });
  });
});

describe("handoffPage", () => {
  it("posts the ticket to the obs host's session path, never in the URL", () => {
    const html = handoffPage("https://obs.mt.example.com", "session.dXNlcg.1800000060.abc_-");
    expect(html).toContain(
      '<form method="post" action="https://obs.mt.example.com/api/observability/session">',
    );
    expect(html).toContain('name="ticket" value="session.dXNlcg.1800000060.abc_-"');
    expect(html).toContain("document.forms[0].submit()");
  });

  it("refuses a ticket or origin that could break out of the markup", () => {
    expect(() => handoffPage("https://obs.x", 'a"><script>')).toThrow();
    expect(() => handoffPage('https://obs.x"><x', "abc")).toThrow();
  });
});
