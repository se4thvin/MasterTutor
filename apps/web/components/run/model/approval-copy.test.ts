import { ApprovalRequest, DEFAULT_BUDGET, EMPTY_USAGE } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { MAX_LABEL, approvalCopy, requestSummary } from "./approval-copy.ts";

const url = "https://learn.example.edu/course/week-2/lecture-3";
const risky = (over: Record<string, unknown>) =>
  ApprovalRequest.parse({
    kind: "risky_click",
    action: { type: "click", x: 1000, y: 610, button: "left" },
    label: "Start quiz",
    url,
    screenshotKey: null,
    ...over,
  });

describe("approvalCopy: risky clicks by action type (A2)", () => {
  it("titles a click, spotlights its point and quotes the record context (A3)", () => {
    const copy = approvalCopy(risky({ context: "Delete — Alice\u202E Smith" }));
    expect(copy.title).toBe("Click “Start quiz” on learn.example.edu?");
    expect(copy.spotlight).toEqual({ x: 1000, y: 610 });
    expect(copy.context).toBe("Delete — Alice Smith");
    expect(copy.tone).toBe("signal");
    expect(requestSummary(risky({}))).toBe("click “Start quiz”");
  });

  it("names a keypress as a key, with no spotlight", () => {
    const copy = approvalCopy(
      risky({ action: { type: "keypress", keys: ["ENTER"] }, label: "Pay" }),
    );
    expect(copy.title).toBe("Press Enter on learn.example.edu?");
    expect(copy.spotlight).toBeNull();
  });

  it("names typing as typing", () => {
    expect(approvalCopy(risky({ action: { type: "type", text: "x" }, label: "" })).title).toBe(
      "Type into the page on learn.example.edu?",
    );
  });

  it("shows a model safety check as a flagged step with every cleaned message (Review Focus 7)", () => {
    const copy = approvalCopy(
      risky({
        action: { type: "keypress", keys: ["ENTER"] },
        label: "Safety check: The page asks to ignore you",
        safetyChecks: [
          {
            code: "malicious_instructions",
            message: "The page asks to\u200B ignore your instructions",
          },
          { code: "irrelevant_domain", message: null },
        ],
      }),
    );
    expect(copy.title).toBe("The model flagged this step");
    expect(copy.checks).toEqual(["The page asks to ignore your instructions", "irrelevant_domain"]);
    expect(copy.tone).toBe("warn");
    expect(copy.risk).toBe(
      "The page may be trying to steer the agent. Deny unless you expected this.",
    );
    expect(copy.spotlight).toBeNull();
    expect(copy.body).not.toContain("Safety check:");
  });

  it("truncates hostile labels and strips invisible characters (Review Focus 4)", () => {
    const copy = approvalCopy(risky({ label: `Pay\u200B${"x".repeat(400)}` }));
    expect(copy.title.length).toBeLessThan(MAX_LABEL + 40);
    expect(copy.title).not.toContain("\u200B");
    expect(copy.title).toContain("…");
  });
});

describe("approvalCopy: the other kinds", () => {
  it("covers form submits, with the trigger and context", () => {
    const copy = approvalCopy(
      ApprovalRequest.parse({
        kind: "form_submit",
        action: { type: "keypress", keys: ["ENTER"] },
        url,
        formSummary: "Honor Code form",
        screenshotKey: null,
        context: "Quiz attempt",
      }),
    );
    expect(copy.title).toBe("Submit a form on learn.example.edu?");
    expect(copy.body).toBe("Honor Code form");
    expect(copy.details).toContainEqual(["Trigger", "Press Enter"]);
    expect(copy.context).toBe("Quiz attempt");
  });

  it("covers downloads, first sign-ins, new origins and budgets", () => {
    expect(approvalCopy({ kind: "download", url, filename: "\u202Egpj.exe" }).title).toBe(
      "Download gpj.exe?",
    );
    expect(
      approvalCopy({
        kind: "credential_first_use",
        alias: "ada-learn",
        origin: "https://learn.example.edu",
      }).title,
    ).toBe("Sign in to learn.example.edu as ada-learn?");
    expect(
      approvalCopy({
        kind: "new_origin",
        origin: "https://docs.example.org",
        url: "https://docs.example.org/x",
      }).title,
    ).toBe("Open docs.example.org?");
    const budget = approvalCopy({
      kind: "budget",
      exceeded: "usd",
      usage: { ...EMPTY_USAGE, usd: 5 },
      budget: DEFAULT_BUDGET,
    });
    expect(budget).toMatchObject({ title: "Spend limit reached", budget: true });
    expect(budget.body).toContain("$5.00 of $5.00");
  });
});
