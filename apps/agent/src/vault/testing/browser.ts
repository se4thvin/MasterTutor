import { POLICY_DECIDER } from "@mastertutor/contracts";
import { createLogger } from "@mastertutor/contracts/server";
import type { Frame, Page } from "playwright-core";
import type { VaultDeps } from "../context.ts";
import {
  BrowserSession,
  type CallApproval,
  type ResolvedTarget,
  type ToolContext,
} from "../runtime.ts";
import { startChromium } from "./chromium.ts";

const silent = createLogger({ service: "vault-test", level: "silent" });

export interface TestBrowser {
  readonly session: BrowserSession;
  readonly page: Page;
  setController(holder: "agent" | "user"): void;
  close(): Promise<void>;
}

/** Full Chromium honours the secure-origin flag WebAuthn needs on http://*.test (verified). */
export function chromiumArgsFor(secureOrigins: readonly string[]): string[] {
  return [
    "--host-resolver-rules=MAP *.test 127.0.0.1",
    ...(secureOrigins.length > 0
      ? [`--unsafely-treat-insecure-origin-as-secure=${secureOrigins.join(",")}`]
      : []),
  ];
}

/** A real B1 BrowserSession (network policy, guard, masking) over a local Chromium (R-E2). */
export async function launchTestBrowser(options: {
  allowedOrigins: readonly string[];
  secureOrigins?: readonly string[];
}): Promise<TestBrowser> {
  const chromium = await startChromium(chromiumArgsFor(options.secureOrigins ?? []));
  try {
    const session = await BrowserSession.connect({
      cdpBaseUrl: chromium.cdpBaseUrl,
      allowedOrigins: () => options.allowedOrigins,
      testMode: true,
      log: silent,
    });
    return {
      session,
      get page() {
        return session.page;
      },
      setController: (holder) =>
        holder === "user" ? session.guard.hold() : session.guard.release(),
      close: async () => {
        await session.close();
        await chromium.stop();
      },
    };
  } catch (error) {
    await chromium.stop();
    throw error;
  }
}

/**
 * What B1's read_page ref resolution yields, found here by CSS selector. For an out-of-process
 * frame it returns that frame's own session, so the vault's frame_mismatch defence stays tested
 * (F13: production refs never reach such frames).
 */
export async function resolveSelector(
  tb: TestBrowser,
  selector: string,
  frame?: Frame,
): Promise<ResolvedTarget> {
  let cdp = await tb.session.cdp();
  if (frame && frame !== tb.page.mainFrame()) {
    cdp = (await tb.session.context.newCDPSession(frame).catch(() => null)) ?? cdp;
  }
  await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const { searchId, resultCount } = await cdp.send("DOM.performSearch", { query: selector });
  const { nodeIds } = await cdp.send("DOM.getSearchResults", {
    searchId,
    fromIndex: 0,
    toIndex: resultCount,
  });
  await cdp.send("DOM.discardSearchResults", { searchId });
  const nodeId = nodeIds[0];
  if (nodeIds.length !== 1 || nodeId === undefined)
    throw new Error(`expected one ${selector}, found ${nodeIds.length}`);
  const { node } = await cdp.send("DOM.describeNode", { nodeId });
  return { cdp, backendNodeId: node.backendNodeId };
}

export function refMap(tb: TestBrowser): {
  ref(selector: string, frame?: Frame): Promise<string>;
  resolve: VaultDeps["resolveRef"];
} {
  const refs = new Map<string, ResolvedTarget>();
  let next = 1;
  return {
    async ref(selector, frame) {
      const id = `e${next++}`;
      refs.set(id, await resolveSelector(tb, selector, frame));
      return id;
    },
    resolve: async (_session, ref) => refs.get(ref) ?? null,
  };
}

/** A person approved a credential_first_use card; `postsTo` is the destination it named, if any. */
export const humanApproval = (userId: string, postsTo: string | null = null): CallApproval => ({
  kind: "credential_first_use",
  decidedBy: userId,
  label: postsTo,
  decidedAt: Date.now(),
});

export const policyApproval = (postsTo: string | null = null): CallApproval => ({
  kind: "credential_first_use",
  decidedBy: POLICY_DECIDER,
  label: postsTo,
  decidedAt: Date.now(),
});

export function toolContext(input: {
  runId: string;
  workspaceId: string;
  session: BrowserSession;
  approval?: CallApproval | null;
  signal?: AbortSignal;
}): ToolContext & { waits: string[]; handOvers: string[] } {
  const waits: string[] = [];
  const handOvers: string[] = [];
  return {
    runId: input.runId,
    workspaceId: input.workspaceId,
    session: input.session,
    signal: input.signal ?? new AbortController().signal,
    log: silent,
    approval: input.approval ?? null,
    requestWait: (reason) => {
      waits.push(reason);
    },
    requestHandOver: (reason) => {
      handOvers.push(reason);
    },
    waits,
    handOvers,
  };
}
