import { createHmac, randomBytes } from "node:crypto";
import type { CDPSession } from "playwright-core";
import { SECRET_REDACTION, type MaskSources } from "./runtime.ts";

const MAX_NODES_PER_RUN = 200;
/** Runs of letters and digits: a secret matches as the same run of words, whatever separates them. */
const WORD = /[\p{L}\p{N}]+/gu;
const TOKEN = /\S+/g;
const JOIN = "\u0000";

/** Elements the vault filled in one frame's document, owned by one CDP session. */
export interface FilledNodes {
  cdp: CDPSession;
  frameId: string;
  backendNodeIds: readonly number[];
}

export interface SecretFingerprints {
  /** Records filled elements to mask; `secret` is null for usernames and one-time codes (deviation 7). */
  remember(runId: string, entry: { filled: FilledNodes; secret: string | null }): void;
  /** B1's mask source for one run (RunHooks.maskSources). */
  forRun(runId: string): MaskSources;
  forgetRun(runId: string): void;
}

/** 1–3 digit secrets match almost every number on a page: they are masked by box only. */
export function isScannableSecret(secret: string): boolean {
  return secret.length > 0 && !(secret.length < 4 && /^\d+$/.test(secret));
}

interface FilledNode {
  cdp: CDPSession;
  frameId: string;
  backendNodeId: number;
}

interface RunEntry {
  nodes: FilledNode[];
  /** Keyed digests of registered secrets (joined word runs, or whole tokens). */
  digests: Set<string>;
  /** Word count → joined lengths of registered secrets: a cheap filter before hashing. */
  windows: Map<number, Set<number>>;
  /** Whether a secret without letters or digits is registered (then whole tokens are checked). */
  bare: boolean;
  unwatch: Map<CDPSession, () => void>;
}

function merge(spans: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const span of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/**
 * B1's masking asks this source which elements the vault filled and where a secret value appears
 * in text. Values are kept only as HMACs under a per-process random key (F7): plaintext never
 * outlives the fill call.
 */
export function createSecretFingerprints(): SecretFingerprints {
  const key = randomBytes(32);
  const runs = new Map<string, RunEntry>();
  const digest = (value: string) => createHmac("sha256", key).update(value, "utf8").digest("hex");

  const entry = (runId: string): RunEntry => {
    let found = runs.get(runId);
    if (!found) {
      found = {
        nodes: [],
        digests: new Set(),
        windows: new Map(),
        bare: false,
        unwatch: new Map(),
      };
      runs.set(runId, found);
    }
    return found;
  };

  /** Filled nodes die with their document: prune on navigation and detach (F8). */
  const watch = (run: RunEntry, cdp: CDPSession) => {
    if (run.unwatch.has(cdp)) return;
    const onNavigated = (event: { frame: { id: string; parentId?: string } }) => {
      const main = event.frame.parentId === undefined;
      run.nodes = run.nodes.filter(
        (node) => node.cdp !== cdp || (!main && node.frameId !== event.frame.id),
      );
    };
    const onDetached = (event: { frameId: string }) => {
      run.nodes = run.nodes.filter((node) => node.cdp !== cdp || node.frameId !== event.frameId);
    };
    cdp.on("Page.frameNavigated", onNavigated);
    cdp.on("Page.frameDetached", onDetached);
    run.unwatch.set(cdp, () => {
      cdp.off("Page.frameNavigated", onNavigated);
      cdp.off("Page.frameDetached", onDetached);
    });
  };

  const register = (run: RunEntry, secret: string) => {
    const words = secret.match(WORD) ?? [];
    if (words.length === 0) {
      const token = secret.trim();
      if (token !== "") {
        run.digests.add(digest(token));
        run.bare = true;
      }
      return;
    }
    const joined = words.join(JOIN);
    run.digests.add(digest(joined));
    const lengths = run.windows.get(words.length) ?? new Set<number>();
    lengths.add(joined.length);
    run.windows.set(words.length, lengths);
  };

  const redact = (run: RunEntry, text: string): string => {
    const spans: Array<[number, number]> = [];
    const words = [...text.matchAll(WORD)];
    for (const [count, lengths] of run.windows) {
      for (let i = 0; i + count <= words.length; i++) {
        const window = words.slice(i, i + count);
        const joined = window.map((word) => word[0]).join(JOIN);
        if (!lengths.has(joined.length) || !run.digests.has(digest(joined))) continue;
        const first = window[0]!;
        const last = window[count - 1]!;
        spans.push([first.index ?? 0, (last.index ?? 0) + last[0].length]);
      }
    }
    if (run.bare) {
      for (const token of text.matchAll(TOKEN)) {
        if (run.digests.has(digest(token[0])))
          spans.push([token.index ?? 0, (token.index ?? 0) + token[0].length]);
      }
    }
    if (spans.length === 0) return text;
    let out = "";
    let cursor = 0;
    for (const [start, end] of merge(spans)) {
      out += text.slice(cursor, start) + SECRET_REDACTION;
      cursor = end;
    }
    return out + text.slice(cursor);
  };

  return {
    remember(runId, { filled, secret }) {
      const run = entry(runId);
      for (const backendNodeId of filled.backendNodeIds)
        run.nodes.push({ cdp: filled.cdp, frameId: filled.frameId, backendNodeId });
      if (run.nodes.length > MAX_NODES_PER_RUN)
        run.nodes.splice(0, run.nodes.length - MAX_NODES_PER_RUN);
      watch(run, filled.cdp);
      if (secret !== null && isScannableSecret(secret)) register(run, secret);
    },
    forRun: (runId) => ({
      // N2: keyed by frame id too, so a fill survives its frame's CDP session being replaced.
      filledFrames: () => [...new Set((runs.get(runId)?.nodes ?? []).map((node) => node.frameId))],
      nodeIds: (cdp) =>
        (runs.get(runId)?.nodes ?? [])
          .filter((node) => node.cdp === cdp)
          .map((node) => node.backendNodeId),
      hasSecrets: () => (runs.get(runId)?.digests.size ?? 0) > 0,
      redact: (text) => {
        const run = runs.get(runId);
        return run && run.digests.size > 0 ? redact(run, text) : text;
      },
    }),
    forgetRun(runId) {
      const run = runs.get(runId);
      if (!run) return;
      for (const unwatch of run.unwatch.values()) unwatch();
      runs.delete(runId);
    },
  };
}
