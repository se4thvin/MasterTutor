import type { IsolatedWorlds } from "./isolated-world.ts";
import { FRAME_OWNERS, type PageHelpers, type TargetDescription } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

/** Arming every document must finish within this, or typing fails closed (approval needed). */
export const ARM_BUDGET_MS = 250;
/** A page with more documents than this is not armed one by one: typing fails closed instead. */
const MAX_DOCUMENTS = 64;

/**
 * The executor's own input is guarded inside the page, in every document, while it is sent.
 * - Typing: in the document holding the focused element ("home") only keystrokes aimed at a secret
 *   field are cancelled; in every other document all of them, so text a page script redirects
 *   mid-typing into another document (a frame's password field) is never delivered.
 * - A click: pointer events are cancelled unless they reach the element the hit test classified
 *   (kept by the scan), so a page that moves or swaps elements between the check and the press
 *   never gets an unchecked click (TOCTOU), whichever document the press lands in. A document
 *   created meanwhile (a frame added anywhere, shadow roots included, or navigated) cancels every
 *   pointer event from its first moment until disarm: none was classified, so none may be pressed.
 * Armed only around the executor's own input, so a person's input and credential filling (B3) are
 * unaffected.
 */
export interface InputGuard {
  /** False when some document did not arm within the budget, or there were too many: fail closed. */
  readonly complete: boolean;
  /**
   * True when the page has more documents than a guard covers (MAX_DOCUMENTS): nothing was
   * armed, and no approval can make a click there safe.
   */
  readonly tooMany: boolean;
  /** True once a document was added or replaced since arming: it is not armed, so stop typing. */
  readonly changed: boolean;
  /**
   * `changed` as of now: every session that armed answers first, so the frame events it sent
   * before are seen. One that does not answer within the budget counts as changed (fail closed).
   */
  changedNow(): Promise<boolean>;
  /** Whether a page script moved focus out of the home document since arming. */
  focusMoved(): Promise<boolean>;
  /**
   * Disarms every document an arm was sent to; resolves true when a document cancelled input.
   * Never throws; never waits on a hung document.
   */
  disarm(): Promise<boolean>;
}

/** Sessions whose last arm could not cover every document (until an arm covers them all again). */
const incomplete = new WeakSet<BrowserSession>();

/**
 * While some document of the page could not be armed, acting on the page (typing, clicking)
 * counts as acting inside an uninspectable page: it needs a person's approval.
 */
export function markUnguarded(
  session: BrowserSession,
  target: TargetDescription | null,
): TargetDescription | null {
  return target && incomplete.has(session) ? { ...target, opaqueFrame: true } : target;
}

const POINTER_EVENTS = [
  "pointerdown",
  "mousedown",
  "pointerup",
  "mouseup",
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
];

/**
 * Installs the guard in this document (`click`: the key the hit test kept its element under, or
 * null for typing); returns whether this is the home document for typing.
 */
export function armScript(
  arg: { owners: string[]; forceHome: boolean; click: string | null; pointerEvents: string[] },
  h: PageHelpers,
): boolean {
  const slot = globalThis as unknown as {
    __mtGuard?: { remove(): void };
    __mtStart?: unknown;
    __mtFound?: { key: string; el: Element };
    __mtCancelled?: boolean;
  };
  slot.__mtGuard?.remove();
  slot.__mtCancelled = false;
  const cancel = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    slot.__mtCancelled = true;
  };
  const listeners: Array<[string, (event: Event) => void]> = [];
  let home = false;
  if (arg.click !== null) {
    const kept = slot.__mtFound?.key === arg.click ? slot.__mtFound.el : null;
    const onPointer = (event: Event) => {
      if (!kept || !event.composedPath().includes(kept)) cancel(event);
    };
    for (const type of arg.pointerEvents) listeners.push([type, onPointer]);
  } else {
    const active = document.activeElement;
    home =
      arg.forceHome || (!!active && !arg.owners.includes(active.tagName) && document.hasFocus());
    slot.__mtStart = active;
    const guard = (event: Event) => {
      const target = event.composedPath()[0];
      if (!home || (target instanceof Element && h.isSecretField(target))) cancel(event);
    };
    const onKey = (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.key.length === 1 && !key.ctrlKey && !key.metaKey) guard(event);
    };
    const onInput = (event: Event) => {
      if ((event as InputEvent).inputType.startsWith("insert")) guard(event);
    };
    listeners.push(["keydown", onKey], ["keypress", onKey], ["beforeinput", onInput]);
  }
  for (const [type, listener] of listeners) addEventListener(type, listener, true);
  slot.__mtGuard = {
    remove() {
      for (const [type, listener] of listeners) removeEventListener(type, listener, true);
    },
  };
  return home;
}

/** In the home document: has focus left it (into a frame, or out to another document)? */
export function focusMovedScript(owners: string[]): boolean {
  const slot = globalThis as unknown as { __mtStart?: Element | null };
  const active = document.activeElement;
  if (active && owners.includes(active.tagName)) return true;
  const idle = !active || active === document.body || active === document.documentElement;
  return idle && slot.__mtStart !== active;
}

/** The world the new-document click guard runs in (apart from the page helpers' world). */
const NEW_DOCUMENT_WORLD = "mastertutor-click-guard";
/** A document the guard never reached (its disarm lost) stops cancelling after this long. */
const NEW_DOCUMENT_GUARD_MS = 2_000;

/**
 * Runs first in every document created while a click is armed (CDP new-document script, so a
 * frame inserted anywhere, closed shadow roots included, is covered before any input reaches
 * it): cancels every pointer event until disarmed. A document.open() rewrite that erases the
 * listeners puts them back before the page's task ends.
 */
export function newDocumentScript(arg: { pointerEvents: string[]; lifetimeMs: number }): void {
  const until = Date.now() + arg.lifetimeMs;
  const state = { active: true, cancelled: false };
  (globalThis as unknown as { __mtNewDoc?: typeof state }).__mtNewDoc = state;
  const cancel = (event: Event) => {
    if (!state.active || Date.now() > until) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.cancelled = true;
  };
  const listen = () => {
    for (const type of arg.pointerEvents) addEventListener(type, cancel, true);
  };
  listen();
  new MutationObserver(listen).observe(document, { childList: true });
}

/** Disarms the new-document guard here; returns whether it cancelled any input. */
export function newDocumentDisarmScript(): boolean {
  const state = (globalThis as unknown as { __mtNewDoc?: { active: boolean; cancelled: boolean } })
    .__mtNewDoc;
  if (!state) return false;
  state.active = false;
  return state.cancelled;
}

/** Removes the guard; returns whether it cancelled any input. */
export function disarmScript(): boolean {
  const slot = globalThis as unknown as { __mtGuard?: { remove(): void }; __mtCancelled?: boolean };
  slot.__mtGuard?.remove();
  delete slot.__mtGuard;
  return slot.__mtCancelled === true;
}

type Doc = { worlds: IsolatedWorlds; frameId: string };
const FRAME_EVENTS = ["Page.frameAttached", "Page.frameNavigated"] as const;
type FrameEvent = { frameId: string } | { frame: { id: string } };

/**
 * Arms the guard in every document of the page (the top session's frames and each out-of-process
 * frame's), within ARM_BUDGET_MS and abortably: a document that does not answer in time (a hung
 * frame) leaves the guard incomplete rather than stalling the step, and an abort disarms at once
 * and rejects with the signal's reason. Arms are never sent after the guard settled, and every
 * document an arm was sent to is disarmed in order on its own session, so a late arm can never
 * outlive the guard and cancel a person's keystrokes.
 */
export function armTypingGuard(session: BrowserSession, signal: AbortSignal): Promise<InputGuard> {
  return armGuard(session, signal, null);
}

/** Arms the click guard for the element the last hit test kept under `key` (HitTest.key). */
export function armClickGuard(
  session: BrowserSession,
  signal: AbortSignal,
  key: string,
): Promise<InputGuard> {
  return armGuard(session, signal, key);
}

async function armGuard(
  session: BrowserSession,
  signal: AbortSignal,
  click: string | null,
): Promise<InputGuard> {
  signal.throwIfAborted();
  let settled = false;
  let changed = false;
  let tooMany = false;
  // Sessions watched for frames added or replaced (Page events, which see every frame, shadow
  // roots included), the documents created meanwhile, and the new-document scripts registered.
  const watched: Array<{ worlds: IsolatedWorlds; onFrame: (event: FrameEvent) => void }> = [];
  const created: Array<{ cdp: IsolatedWorlds["cdp"]; frameId: string }> = [];
  const scripts: Array<{ cdp: IsolatedWorlds["cdp"]; identifier: string }> = [];
  const sent: Doc[] = [];
  const answered = new Set<Doc>();
  let home: Doc | undefined;
  const send = (doc: Doc, forceHome: boolean) => {
    sent.push(doc);
    return doc.worlds
      .evaluate(
        armScript,
        { owners: FRAME_OWNERS, forceHome, click, pointerEvents: POINTER_EVENTS },
        doc.frameId,
      )
      .then((isHome) => {
        answered.add(doc);
        if (isHome) home ??= doc;
      });
  };
  // Every document of one CDP session (its frame tree), watched for frames added or replaced.
  const armSession = async (worlds: IsolatedWorlds): Promise<void> => {
    if (settled) return;
    const onFrame = (event: FrameEvent) => {
      changed = true;
      const frameId = "frameId" in event ? event.frameId : event.frame.id;
      if (click !== null) created.push({ cdp: worlds.cdp, frameId });
    };
    for (const event of FRAME_EVENTS) worlds.cdp.on(event, onFrame);
    watched.push({ worlds, onFrame });
    if (click !== null) {
      const { identifier } = await worlds.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(${newDocumentScript.toString()})(${JSON.stringify({ pointerEvents: POINTER_EVENTS, lifetimeMs: NEW_DOCUMENT_GUARD_MS })})`,
        worldName: NEW_DOCUMENT_WORLD,
      });
      scripts.push({ cdp: worlds.cdp, identifier });
      if (settled) void removeScripts();
    }
    const { frameTree } = await worlds.cdp.send("Page.getFrameTree");
    const docs: Doc[] = [];
    const walk = (tree: typeof frameTree) => {
      docs.push({ worlds, frameId: tree.frame.id });
      for (const child of tree.childFrames ?? []) walk(child);
    };
    walk(frameTree);
    if (settled) return;
    if (sent.length + docs.length > MAX_DOCUMENTS) {
      tooMany = true;
      throw new Error("too many documents");
    }
    await Promise.all(docs.map((doc) => send(doc, false)));
  };
  const armAll = async (): Promise<boolean> => {
    const top = await session.worlds();
    const topArm = armSession(top);
    const others = [...(await session.outOfProcessFrames()).values()];
    await Promise.all([topArm, ...others.map(armSession)]);
    // No document claimed focus (a background window): the top document is home, as before.
    if (click === null && !home && !settled)
      await send({ worlds: top, frameId: await top.mainFrameId() }, true);
    return true;
  };

  const removeScripts = () =>
    Promise.all(
      scripts
        .splice(0)
        .map(({ cdp, identifier }) =>
          cdp
            .send("Page.removeScriptToEvaluateOnNewDocument", { identifier })
            .catch(() => undefined),
        ),
    );
  // Documents created while armed: once no new one can get the script, disarm each of them.
  const disarmCreated = async (): Promise<boolean[]> => {
    await removeScripts();
    for (const { worlds, onFrame } of watched)
      for (const event of FRAME_EVENTS) worlds.cdp.off(event, onFrame);
    return Promise.all(
      created.map(({ cdp, frameId }) =>
        cdp
          .send("Page.createIsolatedWorld", { frameId, worldName: NEW_DOCUMENT_WORLD })
          .then(({ executionContextId }) =>
            cdp.send("Runtime.evaluate", {
              expression: `(${newDocumentDisarmScript.toString()})()`,
              contextId: executionContextId,
              returnByValue: true,
            }),
          )
          .then(({ result }) => result.value === true)
          .catch(() => false),
      ),
    );
  };

  const disarmAll = async (): Promise<boolean> => {
    settled = true;
    // Sent in order after each arm on the same session. Only documents that answered are awaited,
    // and never past the budget.
    const done = sent.map((doc) =>
      doc.worlds.evaluate(disarmScript, null, doc.frameId).catch(() => false),
    );
    const waited = done.filter((_, index) => answered.has(sent[index]!));
    const cancelled = await Promise.race([
      Promise.all([...waited, disarmCreated().then((results) => results.includes(true))]),
      timeout(ARM_BUDGET_MS).then(() => [false]),
    ]);
    return cancelled.includes(true);
  };

  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let complete: boolean;
  try {
    complete = await Promise.race([
      armAll().catch(() => false),
      timeout(ARM_BUDGET_MS).then(() => false),
      aborted,
    ]);
  } catch (error) {
    void disarmAll();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  settled = true;
  if (complete) incomplete.delete(session);
  else incomplete.add(session);
  let disarming: Promise<boolean> | null = null;
  return {
    complete,
    tooMany,
    get changed() {
      return changed;
    },
    changedNow: async () => {
      // Sessions that armed (a session that never answered is why the guard is incomplete).
      const armed = watched
        .map(({ worlds }) => worlds)
        .filter((worlds) => sent.some((doc) => doc.worlds === worlds && answered.has(doc)));
      const flushed = await Promise.race([
        Promise.all(armed.map((worlds) => worlds.evaluate(() => 0, null))).then(
          () => true,
          () => false,
        ),
        timeout(ARM_BUDGET_MS).then(() => false),
      ]);
      return changed || !flushed;
    },
    focusMoved: async () =>
      home
        ? Promise.race([
            home.worlds.evaluate(focusMovedScript, FRAME_OWNERS, home.frameId).catch(() => true),
            timeout(ARM_BUDGET_MS).then(() => true),
          ])
        : false,
    disarm: () => (disarming ??= disarmAll()),
  };
}

/** Resolves after ms without keeping the process alive. */
function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
