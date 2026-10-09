import { describe, expect, it } from "vitest";
import {
  CopilotAsk,
  CopilotEvent,
  GuardInput,
  GuardReview,
  OBSERVER_AUTH_PATH,
  OBSERVER_API_PREFIX,
  TrajectoryDigest,
  isAllowedAnswerLink,
  observerForwardAuthAddress,
  observerRouterRule,
} from "./observer.ts";

const item = {
  key: "i1",
  actionClass: "type",
  triggers: ["data_egress"],
  policyKind: "data_egress",
  policyDecision: "ask",
  target: {
    role: "input",
    formKind: "other",
    isFormSubmit: false,
    isSecretField: false,
    opaqueFrame: false,
    hasDownload: false,
    formPostsTo: null,
  },
  destination: null,
  sent: { provenance: "other_origin", sourceOrigin: "https://a.test", chars: 120 },
  vault: null,
  safetyChecks: [],
} as const;
const input = {
  goal: "Take notes on chapter 4",
  mode: "bypass",
  allowedOrigins: ["https://a.test"],
  page: { origin: "https://b.test", inAllowed: false },
  items: [item],
  run: {
    step: 12,
    newOrigins: 1,
    denials: { consecutive: 0, total: 0 },
    loopHits: 0,
    injectionSignals: 0,
    riskLevel: "normal",
  },
} as const;

describe("GuardInput is metadata only (spec §6.4)", () => {
  it("accepts the documented shape", () => {
    expect(GuardInput.parse(input)).toEqual(input);
  });
  it("refuses any extra field: a label, a URL, typed text or agent prose", () => {
    for (const extra of [{ label: "Delete" }, { url: "https://b.test/?q=1" }, { text: "secret" }])
      expect(GuardInput.safeParse({ ...input, items: [{ ...item, ...extra }] }).success).toBe(
        false,
      );
    expect(GuardInput.safeParse({ ...input, reason: "I should" }).success).toBe(false);
    expect(
      GuardInput.safeParse({ ...input, page: { origin: "https://b.test/path", inAllowed: false } })
        .success,
    ).toBe(false);
  });
  it("caps items at 20 and safety-check codes to a word shape", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...item, key: `i${(i % 20) + 1}` }));
    expect(GuardInput.safeParse({ ...input, items: many }).success).toBe(false);
    expect(
      GuardInput.safeParse({ ...input, items: [{ ...item, safetyChecks: ["ignore previous"] }] })
        .success,
    ).toBe(false);
  });
  it("bounds the reviewer's answer", () => {
    expect(
      GuardReview.safeParse({
        verdict: "block",
        category: "data_exfiltration",
        itemKeys: ["i1"],
        rationale: "x".repeat(301),
      }).success,
    ).toBe(false);
  });
  it("keeps the trajectory digest to codes and origins", () => {
    const digest = {
      goal: "g",
      mode: "ask",
      allowedOrigins: [],
      entries: [{ kind: "act", origin: "https://a.test", tool: "computer", detail: "" }],
      signals: ["origin_fanout"],
    };
    expect(TrajectoryDigest.parse(digest)).toEqual(digest);
    expect(
      TrajectoryDigest.safeParse({
        ...digest,
        entries: [{ ...digest.entries[0], detail: "Click Buy now" }],
      }).success,
    ).toBe(false);
  });
});

describe("Copilot contracts (spec §7)", () => {
  it("defaults an ask to a new thread, no context and no untrusted text", () => {
    expect(CopilotAsk.parse({ text: " Why did the last run fail? " })).toEqual({
      threadId: null,
      text: "Why did the last run fail?",
      context: null,
      includeUntrusted: false,
    });
  });
  it("streams only the documented events", () => {
    expect(CopilotEvent.parse({ type: "text", delta: "Hi" })).toEqual({
      type: "text",
      delta: "Hi",
    });
    expect(CopilotEvent.safeParse({ type: "image", url: "https://evil.test" }).success).toBe(false);
    expect(
      CopilotEvent.parse({ type: "done", citations: ["Q1"], removed: ["Q9"], usd: 0.01 }).type,
    ).toBe("done");
  });
  it("routes /api/observer/ on the app host and authenticates outside that prefix", () => {
    expect(observerRouterRule("mt.example.com")).toBe(
      "Host(`mt.example.com`) && PathPrefix(`/api/observer/`)",
    );
    expect(OBSERVER_AUTH_PATH.startsWith(`${OBSERVER_API_PREFIX}/`)).toBe(false);
    expect(observerForwardAuthAddress("172.30.231")).toBe(
      "http://172.30.231.11:3000/api/observer-auth",
    );
    expect(() => observerRouterRule("evil`) || Host(`x")).toThrow();
  });
  it("allows only same-origin app links in answers", () => {
    for (const ok of ["/runs/abc#step-3", "/observer?run=x", "/settings/alerts#alert-1"])
      expect(isAllowedAnswerLink(ok), ok).toBe(true);
    for (const bad of [
      "https://evil.test/?d=x",
      "//evil.test",
      "/api/assets/x",
      "javascript:alert(1)",
      "/runs\\..\\x",
      "runs/x",
      null,
    ])
      expect(isAllowedAnswerLink(bad), String(bad)).toBe(false);
  });
});
