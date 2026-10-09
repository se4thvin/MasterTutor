import { EMPTY_USAGE } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLlmMock, type LlmMock } from "../../../../../tests/llm-mock/src/server.ts";
import { createOpenAI } from "../../llm/openai.ts";
import { createStepGuard } from "./guard.ts";
import { createGuardReviewer } from "./reviewer.ts";

const CANARY = "vault-canary-value-7f3a9c2e";
let mock: LlmMock;
beforeAll(async () => {
  mock = await startLlmMock();
});
afterAll(async () => mock?.close());

const run = (goal: string) => ({
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  goal,
  title: null,
  model: "m",
  approvalMode: "bypass" as const,
  observerMode: "enforce" as const,
  toolProfile: "browser_use" as const,
  budget: { maxSteps: 1, maxUsd: 1, maxActiveMinutes: 1 },
  usage: EMPTY_USAGE,
  allowedOrigins: [],
  plan: null,
  noteId: null,
});
const redact = (text: string) => text.replaceAll(CANARY, "[secret]");
const typed = {
  item: "c1#0",
  callId: "c1",
  index: 0,
  action: { type: "type", text: `my key is ${CANARY}` } as const,
  tool: null,
  args: null,
  target: {
    label: CANARY,
    tag: "input",
    path: "p",
    context: "c",
    excerpt: CANARY,
    isFormSubmit: false,
    formKind: "other" as const,
    isSecretField: false,
    editable: true,
    interactive: true,
  },
  request: null,
  policy: null,
};

describe("no secret ever reaches the Guard's requests (spec §6.4, §11)", () => {
  it("sends no canary from typed text, labels or excerpts", async () => {
    const before = mock.requests.length;
    const guard = createStepGuard({
      run: run("Take notes"),
      reviewer: createGuardReviewer(createOpenAI({ apiKey: "k", baseURL: `${mock.url}/v1` })),
      redact,
      ledger: { consecutive: 0, total: 0 },
    });
    await guard.review(
      {
        seen: [typed],
        pageOrigin: "https://b.test",
        allowedOrigins: [],
        loopHits: 0,
        label: () => ({ provenance: "novel", sourceOrigin: null, chars: 30 }),
      },
      new AbortController().signal,
    );
    const sent = mock.requests.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) expect(JSON.stringify(request.body)).not.toContain(CANARY);
  });

  it("sends nothing at all when the goal itself carries the canary", async () => {
    const before = mock.requests.length;
    const guard = createStepGuard({
      run: run(`Use ${CANARY} to sign in`),
      reviewer: createGuardReviewer(createOpenAI({ apiKey: "k", baseURL: `${mock.url}/v1` })),
      redact,
      ledger: { consecutive: 0, total: 0 },
    });
    const result = await guard.review(
      {
        seen: [typed],
        pageOrigin: "https://b.test",
        allowedOrigins: [],
        loopHits: 0,
        label: () => ({ provenance: "novel", sourceOrigin: null, chars: 30 }),
      },
      new AbortController().signal,
    );
    expect(mock.requests.length).toBe(before);
    expect(result.outcomes.get("c1#0")?.category).toBe("guard_unavailable");
  });
});
