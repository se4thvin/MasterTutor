import { createHmac, randomBytes } from "node:crypto";
import type { CDPSession } from "playwright-core";
import { foldConfusables } from "./confusables.ts";
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
  remember(
    runId: string,
    entry: { filled: FilledNodes; secret: string | null; code?: string | null },
  ): void;
  /** B1's mask source for one run (RunHooks.maskSources). */
  forRun(runId: string): MaskSources;
  forgetRun(runId: string): void;
}

/**
 * Shortest folded secret the pixel screens match up to OCR confusables: folding drops separators
 * and merges characters, so a short one (a PIN) would match ordinary numbers on the page.
 */
const MIN_FOLDED = 6;
/** A run of letters and digits as OCR shows it (`|` is a misread l or 1). */
const OCR_RUN = /^[\p{L}\p{N}|]+$/u;
const OCR_RUNS = /[\p{L}\p{N}|]+/gu;

/** 1–3 digit secrets match almost every number on a page: they are masked by box only. */
/** How many rounds of URL decoding a token gets: enough for a URL wrapped in a redirect twice. */
const MAX_DECODE_ROUNDS = 3;
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/gi;

/**
 * Up to MAX_DECODE_ROUNDS successively decoded views of a URL token: "+" read as a space, every
 * run of %XX (either hex case) decoded as UTF-8. A run that is not valid UTF-8 stays as it is.
 */
export function decodedViews(token: string): string[] {
  const views: string[] = [];
  let view = token;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    const next = view.replaceAll("+", " ").replace(PERCENT_RUN, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
    if (next === view) break;
    views.push(next);
    view = next;
  }
  return views;
}

/**
 * A secret distinctive enough that finding it in page text means the page shows it: 8+
 * characters, or 6+ mixing two kinds (lower case, upper case, digit, other). A PIN or a plain
 * word ("parity") reads like ordinary text: it is redacted from text and masked as a whole OCR
 * token, but never withholds a whole screenshot and never matches inside a longer word.
 */
export function isDistinctiveSecret(secret: string): boolean {
  const value = secret.trim();
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((kind) =>
    kind.test(value),
  ).length;
  return value.length >= 8 || (value.length >= 6 && kinds >= 2);
}

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
  /** The subset of `digests` from distinctive secrets: only these show a secret on a page. */
  distinctive: Set<string>;
  /** Word count → joined lengths of registered secrets: a cheap filter before hashing. */
  windows: Map<number, Set<number>>;
  /**
   * The same for secrets without letters or digits, matched as runs of whitespace-separated
   * tokens (review 14: "!! ##" matches across any spacing).
   */
  bareWindows: Map<number, Set<number>>;
  /** Bumped whenever a secret or one-time code is registered: pixel screens cached under an older one are stale. */
  version: number;
  /** Keyed digests of one-time codes filled this run, for the local pixel screen (ruling). */
  codes: Set<string>;
  /**
   * Folded length → keyed digests of folded secrets, for OCR'd text (QA-099). `tight` secrets have
   * no separators and match inside one run of letters and digits; `spaced` ones (with separators
   * of their own) match inside one whitespace-free token, separators dropped.
   */
  folded: {
    tight: Map<number, Set<string>>;
    spaced: Map<number, Set<string>>;
    /** Generic secrets: matched only when a whole OCR run (or token) folds to them. */
    whole: Set<string>;
  };
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
        distinctive: new Set(),
        windows: new Map(),
        bareWindows: new Map(),
        codes: new Set(),
        version: 0,
        folded: { tight: new Map(), spaced: new Map(), whole: new Set() },
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
  const add = (
    run: RunEntry,
    windows: Map<number, Set<number>>,
    parts: readonly string[],
    distinctive: boolean,
  ) => {
    const joined = parts.join(JOIN);
    run.digests.add(digest(joined));
    if (distinctive) run.distinctive.add(digest(joined));
    const lengths = windows.get(parts.length) ?? new Set<number>();
    lengths.add(joined.length);
    windows.set(parts.length, lengths);
  };

  const foldedDigest = (folded: string) => digest(`ocr${JOIN}${folded}`);

  const register = (run: RunEntry, secret: string) => {
    const distinctive = isDistinctiveSecret(secret);
    const folded = foldConfusables(secret);
    if (folded.length >= MIN_FOLDED && !distinctive) run.folded.whole.add(foldedDigest(folded));
    else if (folded.length >= MIN_FOLDED) {
      const byLength = OCR_RUN.test(secret.trim()) ? run.folded.tight : run.folded.spaced;
      const digests = byLength.get(folded.length) ?? new Set<string>();
      digests.add(foldedDigest(folded));
      byLength.set(folded.length, digests);
    }
    const words = secret.match(WORD) ?? [];
    if (words.length > 0) return add(run, run.windows, words, distinctive);
    const tokens = secret.match(TOKEN) ?? [];
    if (tokens.length > 0) add(run, run.bareWindows, tokens, distinctive);
  };

  /** Spans of `text` where a registered run of parts occurs, whatever separates the parts. */
  const find = (
    run: RunEntry,
    windows: Map<number, Set<number>>,
    parts: readonly RegExpExecArray[],
    spans: Array<[number, number]>,
    only: Set<string> = run.digests,
  ) => {
    for (const [count, lengths] of windows) {
      for (let i = 0; i + count <= parts.length; i++) {
        const window = parts.slice(i, i + count);
        const joined = window.map((part) => part[0]).join(JOIN);
        if (!lengths.has(joined.length) || !only.has(digest(joined))) continue;
        const first = window[0]!;
        const last = window[count - 1]!;
        spans.push([first.index, last.index + last[0].length]);
      }
    }
  };

  /** True when `text` holds a registered secret (as is); `only` narrows the digests that count. */
  const holds = (run: RunEntry, text: string, only: Set<string> = run.digests): boolean => {
    const spans: Array<[number, number]> = [];
    find(run, run.windows, [...text.matchAll(WORD)], spans, only);
    if (spans.length === 0 && run.bareWindows.size > 0)
      find(run, run.bareWindows, [...text.matchAll(TOKEN)], spans, only);
    return spans.length > 0;
  };

  /**
   * True when OCR'd `text` holds a registered secret's folded form: inside one run of letters and
   * digits, or inside one token for a secret with separators of its own. Never across separators
   * the secret lacks (review: PIN 199005 must not match the date 1990-05-12).
   */
  const inOcrText = (run: RunEntry, text: string): boolean => {
    const holds = (byLength: Map<number, Set<string>>, pieces: Iterable<string>) => {
      if (byLength.size === 0) return false;
      for (const piece of pieces) {
        const folded = foldConfusables(piece);
        for (const [length, digests] of byLength)
          for (let i = 0; i + length <= folded.length; i++)
            if (digests.has(foldedDigest(folded.slice(i, i + length)))) return true;
      }
      return false;
    };
    const whole = (pieces: Iterable<string>) => {
      if (run.folded.whole.size === 0) return false;
      for (const piece of pieces)
        if (run.folded.whole.has(foldedDigest(foldConfusables(piece)))) return true;
      return false;
    };
    return (
      holds(run.folded.tight, text.match(OCR_RUNS) ?? []) ||
      holds(run.folded.spaced, text.match(TOKEN) ?? []) ||
      whole(text.match(OCR_RUNS) ?? []) ||
      whole(text.match(TOKEN) ?? [])
    );
  };

  const redact = (run: RunEntry, text: string): string => {
    const spans: Array<[number, number]> = [];
    find(run, run.windows, [...text.matchAll(WORD)], spans);
    if (run.bareWindows.size > 0) find(run, run.bareWindows, [...text.matchAll(TOKEN)], spans);
    // A URL can carry the secret encoded in any of many ways (strict or form encoding, any hex
    // case, partly, or twice when a redirect wraps it in next=): a token with a % is also read
    // decoded, and if any decoded view holds a secret the whole token goes (final re-review I2).
    for (const token of text.matchAll(TOKEN)) {
      if (!token[0].includes("%")) continue;
      if (decodedViews(token[0]).some((view) => holds(run, view)))
        spans.push([token.index, token.index + token[0].length]);
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
    remember(runId, { filled, secret, code }) {
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
      if (secret !== null && isScannableSecret(secret)) {
        register(run, secret);
        run.version++;
      }
      if (code) {
        run.codes.add(digest(code));
        run.version++;
      }
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
      hasOneTimeCodes: () => (runs.get(runId)?.codes.size ?? 0) > 0,
      isOneTimeCode: (token) => runs.get(runId)?.codes.has(digest(token)) ?? false,
      secretsVersion: () => runs.get(runId)?.version ?? 0,
      redact: (text) => {
        const run = runs.get(runId);
        return run && run.digests.size > 0 ? redact(run, text) : text;
      },
      showsSecret: (text) => {
        const run = runs.get(runId);
        return run !== undefined && run.distinctive.size > 0 && holds(run, text, run.distinctive);
      },
      inOcrText: (text) => {
        const run = runs.get(runId);
        return run !== undefined && inOcrText(run, text);
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
