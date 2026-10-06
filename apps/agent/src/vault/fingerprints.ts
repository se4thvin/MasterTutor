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
  /** The filled document (CDP loaderId), so a frame stays marked only while it shows it. */
  loaderId: string;
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
  loaderId: string;
  backendNodeId: number;
}

interface RunEntry {
  nodes: FilledNode[];
  /** Keyed digests of registered secrets (joined word runs, or whole tokens). */
  digests: Set<string>;
  /** Word count → joined lengths of registered secrets: a cheap filter before hashing. */
  windows: Map<number, Set<number>>;
  /**
   * The same for secrets without letters or digits, matched as runs of whitespace-separated
   * tokens (review 14: "!! ##" matches across any spacing).
   */
  bareWindows: Map<number, Set<number>>;
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
        bareWindows: new Map(),
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

  /** Records a secret as a run of parts (words, or tokens for symbol-only secrets). */
  const add = (run: RunEntry, windows: Map<number, Set<number>>, parts: readonly string[]) => {
    const joined = parts.join(JOIN);
    run.digests.add(digest(joined));
    const lengths = windows.get(parts.length) ?? new Set<number>();
    lengths.add(joined.length);
    windows.set(parts.length, lengths);
  };

  const registerForm = (run: RunEntry, secret: string) => {
    const words = secret.match(WORD) ?? [];
    if (words.length > 0) return add(run, run.windows, words);
    const tokens = secret.match(TOKEN) ?? [];
    if (tokens.length > 0) add(run, run.bareWindows, tokens);
  };

  /**
   * A secret as typed, and as a URL carries it: percent-encoded (encodeURIComponent) and
   * form-encoded (%XX, + for a space), as a GET form or a redirect puts it in the query. "%23"
   * turns "#9" into the word "239", so each form is its own run of words (final review I2).
   */
  const register = (run: RunEntry, secret: string) => {
    const forms = new Set([
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ v: secret }).toString().slice("v=".length),
    ]);
    for (const form of forms) registerForm(run, form);
  };

  /** Spans of `text` where a registered run of parts occurs, whatever separates the parts. */
  const find = (
    run: RunEntry,
    windows: Map<number, Set<number>>,
    parts: readonly RegExpExecArray[],
    spans: Array<[number, number]>,
  ) => {
    for (const [count, lengths] of windows) {
      for (let i = 0; i + count <= parts.length; i++) {
        const window = parts.slice(i, i + count);
        const joined = window.map((part) => part[0]).join(JOIN);
        if (!lengths.has(joined.length) || !run.digests.has(digest(joined))) continue;
        const first = window[0]!;
        const last = window[count - 1]!;
        spans.push([first.index, last.index + last[0].length]);
      }
    }
  };

  const redact = (run: RunEntry, text: string): string => {
    const spans: Array<[number, number]> = [];
    find(run, run.windows, [...text.matchAll(WORD)], spans);
    if (run.bareWindows.size > 0) find(run, run.bareWindows, [...text.matchAll(TOKEN)], spans);
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
        run.nodes.push({
          cdp: filled.cdp,
          frameId: filled.frameId,
          loaderId: filled.loaderId,
          backendNodeId,
        });
      if (run.nodes.length > MAX_NODES_PER_RUN)
        run.nodes.splice(0, run.nodes.length - MAX_NODES_PER_RUN);
      watch(run, filled.cdp);
      if (secret !== null && isScannableSecret(secret)) register(run, secret);
    },
    forRun: (runId) => ({
      // N2: keyed by frame id too, so a fill survives its frame's CDP session being replaced.
      filledFrames: () => {
        const frames = new Map<string, { frameId: string; loaderId: string }>();
        for (const { frameId, loaderId } of runs.get(runId)?.nodes ?? [])
          frames.set(`${frameId}\u0000${loaderId}`, { frameId, loaderId });
        return [...frames.values()];
      },
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
