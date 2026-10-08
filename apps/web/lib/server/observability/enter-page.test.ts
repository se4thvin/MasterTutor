import { OBSERVE_UI_SESSION } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { enterPage } from "./enter-page.ts";

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
