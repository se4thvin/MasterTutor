import { DEFAULT_BUDGET } from "@mastertutor/contracts";
import { describe, expect, it } from "vitest";
import { ids } from "@/lib/fixtures/ids.ts";
import {
  buildCreateRunInput,
  originVariants,
  parseSource,
  startErrorCopy,
  type TaskDraft,
} from "./draft.ts";

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  goal: "Every lecture and figure",
  sources: [],
  domains: [],
  budget: "standard",
  standardBudget: DEFAULT_BUDGET,
  approvalMode: "ask",
  targetFolderId: null,
  bypassAcknowledged: false,
  ...over,
});

describe("parseSource", () => {
  it("detects web, YouTube and PDF sources", () => {
    expect(parseSource("learn.example.edu/course/week-2")).toMatchObject({
      kind: "web",
      host: "learn.example.edu",
      label: "learn.example.edu/course/week-2",
      origin: "https://learn.example.edu",
    });
    expect(parseSource("https://www.youtube.com/watch?v=k3Wm9xTq2aE")?.kind).toBe("youtube");
    expect(parseSource("https://youtu.be/k3Wm9xTq2aE")?.kind).toBe("youtube");
    expect(parseSource("https://arxiv.org/pdf/1706.03762.PDF")?.kind).toBe("pdf");
  });

  it("rejects non-http schemes, credentials and junk", () => {
    expect(parseSource("javascript:alert(1)")).toBeNull();
    expect(parseSource("https://user:pw@example.com")).toBeNull();
    expect(parseSource("   ")).toBeNull();
    expect(parseSource("file:///etc/passwd")).toBeNull();
  });
});

describe("originVariants", () => {
  it("adds the www/apex twin, keeps ports, skips IPs and localhost", () => {
    expect(originVariants("https://youtube.com")).toEqual([
      "https://youtube.com",
      "https://www.youtube.com",
    ]);
    expect(originVariants("https://www.example.com:8443")).toEqual([
      "https://www.example.com:8443",
      "https://example.com:8443",
    ]);
    expect(originVariants("http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(originVariants("http://192.168.1.4")).toEqual(["http://192.168.1.4"]);
  });
});

describe("buildCreateRunInput", () => {
  it("lists sources in the goal and allows their origins plus extra domains", () => {
    const yt = parseSource("https://www.youtube.com/watch?v=k3Wm9xTq2aE")!;
    const input = buildCreateRunInput(draft({ sources: [yt], domains: ["https://github.com"] }));
    expect(input).toMatchObject({
      goal: `Every lecture and figure\n\nSources:\n- ${yt.url}`,
      allowedOrigins: [
        "https://www.youtube.com",
        "https://youtube.com",
        "https://github.com",
        "https://www.github.com",
      ],
      budget: DEFAULT_BUDGET,
      approvalMode: "ask",
      targetFolderId: null,
    });
  });

  it("uses presets, auto mode and a target folder", () => {
    const input = buildCreateRunInput(
      draft({
        domains: ["https://a.example"],
        budget: "deep",
        approvalMode: "auto_within_allowlist",
        targetFolderId: ids.folder(2),
      }),
    );
    expect(input).toMatchObject({
      budget: { maxSteps: 300, maxUsd: 10, maxActiveMinutes: 120 },
      approvalMode: "auto_within_allowlist",
      targetFolderId: ids.folder(2),
    });
  });

  it("starts a run from a goal alone: no source, no allowed domain", () => {
    expect(buildCreateRunInput(draft())).toEqual({
      goal: "Every lecture and figure",
      allowedOrigins: [],
      budget: DEFAULT_BUDGET,
      targetFolderId: null,
      approvalMode: "ask",
      observerMode: "enforce",
      toolProfile: "browser_use",
    });
  });

  it("explains what is missing", () => {
    expect(buildCreateRunInput(draft({ goal: "  " }))).toEqual({
      error: "Describe the task to start.",
    });
    expect(buildCreateRunInput(draft({ approvalMode: "auto_within_allowlist" }))).toEqual({
      error: "Auto mode needs an allowed domain. Add one, or choose Ask me.",
      field: "domains",
    });
    expect(
      buildCreateRunInput(draft({ goal: "x".repeat(4_100), domains: ["https://a.example"] })),
    ).toEqual({
      error: "That's too long. Keep the task under 4,000 characters.",
    });
  });
});

describe("startErrorCopy", () => {
  it("names a bad request and a rate limit; anything else just says it failed", () => {
    expect(startErrorCopy({ code: "BAD_REQUEST" })).toBe("Check the task details and try again.");
    expect(startErrorCopy({ code: "TOO_MANY_REQUESTS" })).toBe(
      "Too many requests. Wait a moment and try again.",
    );
    expect(startErrorCopy({ code: "CONFLICT" })).toBe("Couldn't start the task. Try again.");
    expect(startErrorCopy(new TypeError("Failed to fetch"))).toBe(
      "Couldn't start the task. Try again.",
    );
  });
});

describe("bypass mode (D44): an explicit, acknowledged opt-in", () => {
  it("refuses bypass until the warning is acknowledged", () => {
    expect(
      buildCreateRunInput(draft({ domains: ["https://a.example"], approvalMode: "bypass" })),
    ).toEqual({ error: "Confirm that you understand bypass mode before starting." });
  });

  it("sends bypassAcknowledged only with bypass", () => {
    const bypass = buildCreateRunInput(
      draft({ domains: ["https://a.example"], approvalMode: "bypass", bypassAcknowledged: true }),
    );
    expect(bypass).toMatchObject({ approvalMode: "bypass", bypassAcknowledged: true });
    const ask = buildCreateRunInput(
      draft({ domains: ["https://a.example"], bypassAcknowledged: true }),
    );
    expect(ask).toMatchObject({ approvalMode: "ask" });
    expect(ask).not.toHaveProperty("bypassAcknowledged", true);
  });
});

describe("buildCreateRunInput never throws (M3)", () => {
  it("turns a schema failure into the form's error branch", () => {
    const bad = draft({
      domains: ["https://a.example"],
      standardBudget: { maxSteps: -1, maxUsd: 5, maxActiveMinutes: 30 },
    });
    expect(buildCreateRunInput(bad)).toEqual({ error: "Check the task details and try again." });
  });
});
