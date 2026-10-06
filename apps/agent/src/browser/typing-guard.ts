import type { IsolatedWorlds } from "./isolated-world.ts";
import { FRAME_OWNERS, type PageHelpers } from "./page-helpers.ts";
import type { BrowserSession } from "./session.ts";

/** Arming every document must finish within this, or typing fails closed (approval needed). */
export const ARM_BUDGET_MS = 250;
/** A page with more documents than this is not armed one by one: typing fails closed instead. */
const MAX_DOCUMENTS = 64;

/**
 * Keystrokes the executor sends are guarded inside the page while it types: in the document holding
 * the focused element ("home") only those aimed at a secret field are cancelled; in every other
 * document all of them, so text a page script redirects mid-typing into another document (a frame's
 * password field) is never delivered. Armed only around the executor's own typing, so credential
 * filling (B3) is unaffected.
 */
export interface TypingGuard {
  /** False when some document did not arm within the budget, or there were too many: fail closed. */
  readonly complete: boolean;
  /** True once a document was added or replaced since arming: it is not armed, so stop typing. */
  readonly changed: boolean;
  /** Whether a page script moved focus out of the home document since arming. */
  focusMoved(): Promise<boolean>;
  /** Disarms every document an arm was sent to. Never throws; never waits on a hung document. */
  disarm(): Promise<void>;
}

/** Sessions whose last arm could not cover every document (until an arm covers them all again). */
const incomplete = new WeakSet<BrowserSession>();

/** True while some document of the page could not be armed: typing there needs approval. */
export function typingGuardIncomplete(session: BrowserSession): boolean {
  return incomplete.has(session);
}

/** Installs the guard in this document; returns whether it is the home document. */
export function armScript(arg: { owners: string[]; forceHome: boolean }, h: PageHelpers): boolean {
  const slot = globalThis as unknown as { __mtGuard?: { remove(): void }; __mtStart?: unknown };
  slot.__mtGuard?.remove();
  const active = document.activeElement;
  const home =
    arg.forceHome || (!!active && !arg.owners.includes(active.tagName) && document.hasFocus());
  slot.__mtStart = active;
  const guard = (event: Event) => {
    const target = event.composedPath()[0];
    if (!home || (target instanceof Element && h.isSecretField(target))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const onKey = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key.length === 1 && !key.ctrlKey && !key.metaKey) guard(event);
  };
  const onInput = (event: Event) => {
    if ((event as InputEvent).inputType.startsWith("insert")) guard(event);
  };
  addEventListener("keydown", onKey, true);
  addEventListener("keypress", onKey, true);
  addEventListener("beforeinput", onInput, true);
  slot.__mtGuard = {
    remove() {
      removeEventListener("keydown", onKey, true);
      removeEventListener("keypress", onKey, true);
      removeEventListener("beforeinput", onInput, true);
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

export function disarmScript(): void {
  const slot = globalThis as unknown as { __mtGuard?: { remove(): void } };
  slot.__mtGuard?.remove();
  delete slot.__mtGuard;
}

type Doc = { worlds: IsolatedWorlds; frameId: string };
const FRAME_EVENTS = ["Page.frameAttached", "Page.frameNavigated"] as const;

/**
 * Arms the guard in every document of the page (the top session's frames and each out-of-process
 * frame's), within ARM_BUDGET_MS and abortably: a document that does not answer in time (a hung
 * frame) leaves the guard incomplete rather than stalling the step, and an abort disarms at once
 * and rejects with the signal's reason. Arms are never sent after the guard settled, and every
 * document an arm was sent to is disarmed in order on its own session, so a late arm can never
 * outlive the guard and cancel a person's keystrokes.
 */
export async function armTypingGuard(
  session: BrowserSession,
  signal: AbortSignal,
): Promise<TypingGuard> {
  signal.throwIfAborted();
  let settled = false;
  let changed = false;
  const onChange = () => (changed = true);
  const watched: IsolatedWorlds[] = [];
  const sent: Doc[] = [];
  const answered = new Set<Doc>();
  let home: Doc | undefined;
  const send = (doc: Doc, forceHome: boolean) => {
    sent.push(doc);
    return doc.worlds
      .evaluate(armScript, { owners: FRAME_OWNERS, forceHome }, doc.frameId)
      .then((isHome) => {
        answered.add(doc);
        if (isHome) home ??= doc;
      });
  };
  // Every document of one CDP session (its frame tree), watched for frames added or replaced.
  const armSession = async (worlds: IsolatedWorlds): Promise<void> => {
    if (settled) return;
    for (const event of FRAME_EVENTS) worlds.cdp.on(event, onChange);
    watched.push(worlds);
    const { frameTree } = await worlds.cdp.send("Page.getFrameTree");
    const docs: Doc[] = [];
    const walk = (tree: typeof frameTree) => {
      docs.push({ worlds, frameId: tree.frame.id });
      for (const child of tree.childFrames ?? []) walk(child);
    };
    walk(frameTree);
    if (settled) return;
    if (sent.length + docs.length > MAX_DOCUMENTS) throw new Error("too many documents");
    await Promise.all(docs.map((doc) => send(doc, false)));
  };
  const armAll = async (): Promise<boolean> => {
    const top = await session.worlds();
    const topArm = armSession(top);
    const others = [...(await session.outOfProcessFrames()).values()];
    await Promise.all([topArm, ...others.map(armSession)]);
    // No document claimed focus (a background window): the top document is home, as before.
    if (!home && !settled) await send({ worlds: top, frameId: await top.mainFrameId() }, true);
    return true;
  };

  const disarmAll = (): Promise<void> => {
    settled = true;
    for (const worlds of watched) for (const event of FRAME_EVENTS) worlds.cdp.off(event, onChange);
    // Sent in order after each arm on the same session. Only documents that answered are awaited,
    // and never past the budget.
    const done = sent.map((doc) =>
      doc.worlds.evaluate(disarmScript, null, doc.frameId).catch(() => undefined),
    );
    const waited = done.filter((_, index) => answered.has(sent[index]!));
    return Promise.race([Promise.all(waited).then(() => undefined), timeout(ARM_BUDGET_MS)]);
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
  let disarming: Promise<void> | null = null;
  return {
    complete,
    get changed() {
      return changed;
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
