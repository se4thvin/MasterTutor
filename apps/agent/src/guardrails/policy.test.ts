import { ApprovalRequest } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import type { TargetDescription } from "../browser/page-helpers.ts";
import {
  approvalExcerpt,
  approvalRequestFor,
  downloadRequest,
  needsApproval,
  redactedExcerpt,
} from "./policy.ts";

const target = (overrides: Partial<TargetDescription>): TargetDescription => ({
  label: "",
  tag: "button",
  path: "button",
  context: "ctx",
  isFormSubmit: false,
  formKind: null,
  isSecretField: false,
  editable: false,
  interactive: true,
  ...overrides,
});
const click = { type: "click" as const, x: 10, y: 10, button: "left" as const };

describe("needsApproval (spec §5.5)", () => {
  it("flags risky labels and non-login, non-search form submits", () => {
    expect(needsApproval(click, target({ label: "Delete account" }))).toMatchObject({
      kind: "risky_click",
      label: "Delete account",
    });
    expect(
      needsApproval(click, target({ label: "Go", isFormSubmit: true, formKind: "other" })),
    ).toMatchObject({ kind: "form_submit" });
    expect(
      needsApproval(click, target({ label: "Sign in", isFormSubmit: true, formKind: "login" })),
    ).toBeNull();
    expect(
      needsApproval(click, target({ label: "Search", isFormSubmit: true, formKind: "search" })),
    ).toBeNull();
    expect(needsApproval(click, target({ label: "Check" }))).toBeNull();
  });
  it("treats Enter, or a newline typed into an 'other' form, as a submit", () => {
    const field = target({ editable: true, formKind: "other", tag: "input" });
    expect(needsApproval({ type: "keypress", keys: ["ENTER"] }, field)).toMatchObject({
      kind: "form_submit",
    });
    expect(needsApproval({ type: "type", text: "hi\n" }, field)).toMatchObject({
      kind: "form_submit",
    });
    expect(needsApproval({ type: "type", text: "hi" }, field)).toBeNull();
    expect(
      needsApproval({ type: "keypress", keys: ["ENTER"] }, target({ formKind: "search" })),
    ).toBeNull();
  });
  it("applies risky labels to Enter and Space on the focused element", () => {
    const risky = target({ label: "Delete account" });
    expect(needsApproval({ type: "keypress", keys: ["ENTER"] }, risky)).toMatchObject({
      kind: "risky_click",
      label: "Delete account",
    });
    expect(needsApproval({ type: "keypress", keys: ["SPACE"] }, risky)).toMatchObject({
      kind: "risky_click",
    });
    expect(needsApproval({ type: "keypress", keys: ["enter"] }, risky)).not.toBeNull();
    expect(
      needsApproval({ type: "keypress", keys: ["SPACE"] }, target({ label: "Check" })),
    ).toBeNull();
    expect(needsApproval({ type: "keypress", keys: ["A"] }, risky)).toBeNull();
  });
  it("treats Enter or Space with any modifiers on a submit control like a click (R29-2)", () => {
    const save = target({ label: "Save", isFormSubmit: true, formKind: "other" });
    for (const keys of [
      ["SPACE"],
      ["SHIFT", "SPACE"],
      ["CTRL", "SPACE"],
      ["ALT", "SPACE"],
      ["META", "SPACE"],
      ["SHIFT", "ENTER"],
      ["ENTER"],
    ])
      expect(needsApproval({ type: "keypress", keys }, save)).toMatchObject({
        kind: "form_submit",
      });
    // Click parity: login and search submits stay ungated.
    for (const formKind of ["login", "search"] as const)
      expect(
        needsApproval(
          { type: "keypress", keys: ["SPACE"] },
          target({ label: "Go", isFormSubmit: true, formKind }),
        ),
      ).toBeNull();
    // A space in a text field is text, not an activation.
    const field = target({ editable: true, formKind: "other", tag: "input" });
    expect(needsApproval({ type: "keypress", keys: ["SPACE"] }, field)).toBeNull();
    expect(needsApproval({ type: "type", text: "hello world" }, field)).toBeNull();
    // Enter anywhere in an 'other' form submits it, with modifiers too.
    expect(needsApproval({ type: "keypress", keys: ["CTRL", "ENTER"] }, field)).toMatchObject({
      kind: "form_submit",
    });
  });
  it("fails closed on an embedded page that could not be inspected (R29-1)", () => {
    const opaque = target({ tag: "iframe", label: "", opaqueFrame: true });
    for (const action of [
      click,
      { type: "double_click" as const, x: 1, y: 1 },
      { type: "keypress" as const, keys: ["ENTER"] },
      { type: "keypress" as const, keys: ["SPACE"] },
      { type: "keypress" as const, keys: ["SHIFT", "SPACE"] },
      { type: "type" as const, text: "ok\n" },
    ])
      expect(needsApproval(action, opaque)).toMatchObject({ kind: "form_submit" });
    expect(needsApproval({ type: "keypress", keys: ["CTRL", "A"] }, opaque)).toBeNull();
    expect(needsApproval({ type: "keypress", keys: ["TAB"] }, opaque)).toBeNull();
  });
  it("needs approval to put text into an embedded page it could not inspect (interim, before B3)", () => {
    const opaque = target({ tag: "iframe", label: "", opaqueFrame: true });
    for (const keys of [["A"], ["SHIFT", "A"], ["1"], ["SPACE"], ["@"]])
      expect(needsApproval({ type: "keypress", keys }, opaque)).toMatchObject({
        kind: "form_submit",
      });
    expect(needsApproval({ type: "type", text: "plain text" }, opaque)).toMatchObject({
      kind: "form_submit",
    });
  });
  it("treats every line break and Enter alias as Enter (N2)", () => {
    const field = target({ editable: true, formKind: "other", tag: "input" });
    for (const text of ["hello\r", "hello\n", "hello\r\nmore"])
      expect(needsApproval({ type: "type", text }, field)).toMatchObject({ kind: "form_submit" });
    const opaque = target({ tag: "iframe", label: "", opaqueFrame: true });
    expect(needsApproval({ type: "type", text: "x\r" }, opaque)).toMatchObject({
      kind: "form_submit",
    });
    const save = target({ label: "Save", isFormSubmit: true, formKind: "other" });
    for (const keys of [["\n"], ["\r"], ["Return"], ["NumpadEnter"], [" "], ["SHIFT", "\r"]])
      expect(needsApproval({ type: "keypress", keys }, save)).toMatchObject({
        kind: "form_submit",
      });
    for (const keys of [["\r"], ["NumpadEnter"]])
      expect(needsApproval({ type: "keypress", keys }, field)).toMatchObject({
        kind: "form_submit",
      });
  });
  it("builds contract-valid approval requests with the action and a clean record excerpt", () => {
    const need = needsApproval(click, target({ label: "Pay now" }));
    expect(approvalRequestFor(need!, "https://a.com/x", null, null)).toEqual({
      kind: "risky_click",
      action: click,
      label: "Pay now",
      url: "https://a.com/x",
      screenshotKey: null,
      context: null,
    });
    const enter = { type: "keypress" as const, keys: ["ENTER"] };
    const form = needsApproval(enter, target({ editable: true, formKind: "other", tag: "input" }));
    const request = approvalRequestFor(
      form!,
      "https://a.com/x",
      null,
      approvalExcerpt("Bob‮  Row\n 7"),
    );
    expect(ApprovalRequest.parse(request)).toMatchObject({
      kind: "form_submit",
      action: enter,
      context: "Bob Row 7",
    });
    expect(approvalExcerpt("x".repeat(500))).toHaveLength(240);
    expect(approvalExcerpt("  ​ ")).toBeNull();
    expect(approvalExcerpt(undefined)).toBeNull();
  });
});

describe("approval card excerpt (review M2, M3)", () => {
  const LONE_SURROGATE = /\p{Cs}/u;
  it("is safe for jsonb: no control characters and no split surrogate pair", () => {
    expect(approvalExcerpt("a\u0000b\u0007c")).toBe("abc");
    const emoji = approvalExcerpt(`${"x".repeat(239)}\u{1F600}`)!;
    expect(emoji.length).toBeLessThanOrEqual(240);
    expect(LONE_SURROGATE.test(emoji)).toBe(false);
    expect(LONE_SURROGATE.test(approvalExcerpt("a\ud83d b")!)).toBe(false);
    expect(() => JSON.parse(JSON.stringify(approvalExcerpt("q\u0000\ud83d")))).not.toThrow();
  });

  it("redacts after cleaning and before capping, so no part of a secret survives", () => {
    const redact = (text: string) => text.replaceAll("hunter2-secret", "[secret]");
    // Straddles the 240 cap: capping first would leave "hunter2-se" on the card.
    const straddling = redactedExcerpt(`${"x ".repeat(117)}hunter2-secret tail`, redact)!;
    expect(straddling).not.toContain("hunt");
    expect(straddling.length).toBeLessThanOrEqual(240);
    // Full-width characters only match once NFKC has normalised them.
    expect(redactedExcerpt("pw: ｈｕｎｔｅｒ２-secret", redact)).toBe("pw: [secret]");
    expect(redactedExcerpt(undefined, redact)).toBeNull();
  });
});

describe("downloads (spec §9)", () => {
  const download = { url: "https://a.test/files/r.csv", filename: "r.csv" };

  it("needs a download approval to activate a download link, by click or by Enter", () => {
    const link = target({ tag: "a", label: "Delete report", download });
    for (const action of [click, { type: "keypress" as const, keys: ["ENTER"] }]) {
      const need = needsApproval(action, link);
      expect(need).toMatchObject({ kind: "download", ...download });
      const request = approvalRequestFor(need!, "https://a.test/", null, null);
      expect(ApprovalRequest.parse(request)).toEqual({ kind: "download", ...download });
    }
  });

  it("cleans the URL and name for the card: no credentials, no payload, no path or controls", () => {
    expect(downloadRequest("https://u:p@a.test/f.csv", "../../etc/pass\u202ewd")).toEqual({
      kind: "download",
      url: "https://a.test/f.csv",
      filename: "_.._etc_passwd",
    });
    const data = downloadRequest("data:text/csv;base64,c2VjcmV0", null);
    expect(data).toMatchObject({ kind: "download", filename: null });
    // No payload on the card, but its hash: another content makes another card (I4).
    expect(data.kind === "download" && data.url).toMatch(
      /^data:text\/csv,\.\.\. \(sha256 [0-9a-f]{16}\)$/,
    );
    expect(downloadRequest("data:text/csv;base64,b3RoZXI=", null)).not.toEqual(data);
    expect(JSON.stringify(data)).not.toContain("c2VjcmV0");
    expect(downloadRequest("blob:https://a.test/0b1c", ". . .")).toMatchObject({ filename: null });
    expect(downloadRequest("https://a.test/f", "x".repeat(300))).toMatchObject({
      filename: "x".repeat(255),
    });
  });
});
