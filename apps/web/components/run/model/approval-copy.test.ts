import { ApprovalRequest, DEFAULT_BUDGET, EMPTY_USAGE } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { offSiteSignInRequest } from "@/lib/fixtures/run-recording.ts";
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

describe("approvalCopy: a sign-in form that posts elsewhere (I1)", () => {
  it("names where the credential would go, as a warning", () => {
    const copy = approvalCopy(offSiteSignInRequest());
    expect(copy.title).toBe("Send your ada-learn sign-in to evil.example?");
    expect(copy.tone).toBe("warn");
    expect(copy.risk).toBe(
      "This form sends your sign-in to a different site than the one you're on. Deny unless you trust it.",
    );
    expect(copy.details).toContainEqual(["Sends to", "evil.example"]);
  });

  it("cleans a spoofed destination instead of showing it raw", () => {
    const copy = approvalCopy({ ...offSiteSignInRequest(), postsTo: "not a url \u202Egpj.exe" });
    expect(copy.title).not.toContain("\u202E");
    // Not an origin at all: never echoed, just "an unknown site".
    expect(copy.details).toContainEqual(["Sends to", "an unknown site"]);
  });

  it("keeps the plain sign-in copy when the form posts to the same site", () => {
    const { postsTo: _drop, ...sameSite } = offSiteSignInRequest();
    expect(approvalCopy(sameSite as ApprovalRequest)).toMatchObject({
      title: "Sign in to learn.example.edu as ada-learn?",
      tone: "signal",
    });
  });
});

describe("approvalCopy: hostile lengths stay bounded (S6)", () => {
  const long = "x".repeat(2_000);
  it("caps safety-check messages and form summaries", () => {
    // Beyond the contract's own limits: the card must not rely on them.
    const checks = approvalCopy({
      ...risky({ action: { type: "keypress", keys: ["ENTER"] } }),
      safetyChecks: [{ code: "malicious_instructions", message: long }],
    } as ApprovalRequest).checks;
    expect([...(checks[0] ?? "")].length).toBeLessThanOrEqual(300);
    // Beyond the contract's own limits: the card must not rely on them.
    const form = approvalCopy({
      kind: "form_submit",
      url,
      formSummary: long,
      screenshotKey: null,
    } as ApprovalRequest);
    expect([...form.body].length).toBeLessThanOrEqual(300);
  });
});

describe("approvalCopy: a sign-in form with several destinations (I1, re-review)", () => {
  const signIn = (postsTo: string) => ({ ...offSiteSignInRequest(), postsTo });

  it("names every destination; an evil host that sorts last is never cut off", () => {
    const copy = approvalCopy(
      signIn(
        "https://login.microsoftonline.com, https://shibboleth.learn.example.edu, https://zz-evil.example",
      ),
    );
    expect(copy.title).toBe("Send your ada-learn sign-in to 3 other sites?");
    expect(copy.tone).toBe("warn");
    expect(copy.details.filter(([k]) => k === "Sends to")).toEqual([
      ["Sends to", "login.microsoftonline.com"],
      ["Sends to", "shibboleth.learn.example.edu"],
      ["Sends to", "zz-evil.example"],
    ]);
  });

  it("shows an action that has no origin as an unknown site", () => {
    const copy = approvalCopy(signIn("null, https://evil.example"));
    expect(copy.details.filter(([k]) => k === "Sends to")).toEqual([
      ["Sends to", "an unknown site"],
      ["Sends to", "evil.example"],
    ]);
    expect(approvalCopy(signIn("invalid")).title).toBe(
      "Send your ada-learn sign-in to an unknown site?",
    );
  });

  it("keeps the last host of a 2,000-character list whole", () => {
    const hosts = Array.from(
      { length: 80 },
      (_, i) => `https://site-${String(i).padStart(2, "0")}.example`,
    );
    const list = [...hosts, "https://zz-evil.example"].join(", ");
    expect(list.length).toBeGreaterThan(2_000);
    const rows = approvalCopy(signIn(list)).details.filter(([k]) => k === "Sends to");
    expect(rows).toHaveLength(81);
    expect(rows.at(-1)).toEqual(["Sends to", "zz-evil.example"]);
  });
});

describe("approvalCopy: duplicate destinations (M8)", () => {
  it("counts a host once, in its first position", () => {
    const copy = approvalCopy({
      ...offSiteSignInRequest(),
      postsTo: "http://evil.example, https://evil.example, https://other.example",
    });
    expect(copy.title).toBe("Send your ada-learn sign-in to 2 other sites?");
    expect(copy.details.filter(([k]) => k === "Sends to")).toEqual([
      ["Sends to", "evil.example"],
      ["Sends to", "other.example"],
    ]);
  });
});

describe("requestSummary: an off-site sign-in names its destination in the timeline (M6)", () => {
  it("says where the sign-in went", () => {
    expect(requestSummary(offSiteSignInRequest())).toBe(
      "send your ada-learn sign-in to evil.example",
    );
    expect(
      requestSummary({
        ...offSiteSignInRequest(),
        postsTo: "https://a.example, https://b.example",
      }),
    ).toBe("send your ada-learn sign-in to 2 other sites");
    const { postsTo: _drop, ...sameSite } = offSiteSignInRequest();
    expect(requestSummary(sameSite as ApprovalRequest)).toBe("sign in as ada-learn");
  });
});
