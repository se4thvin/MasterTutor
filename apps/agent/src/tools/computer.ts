import type { ActionEffect, ActionTarget, ComputerAction } from "@mastertutor/contracts";
import { focusTarget, hitTest, scrollState, type ScrollState } from "../browser/hit-test.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { BrowserSession } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import { armClickGuard, armTypingGuard, markUnguarded } from "../browser/input-guard.ts";
import { pause } from "../runtime/abortable.ts";
import type { Clock } from "../runtime/clock.ts";
import { OmniboxEmulator, matchAccelerator, type Accelerator } from "./accelerators.ts";
import { UnknownKey, normalizeCombo, toPlaywrightCombo } from "./keys.ts";

export interface ComputerRun {
  executed: number;
  notes: string[];
  /** What each executed action did, in order (one per executed action). */
  effects: ActionEffect[];
  /** Aligned with `effects`: where each page input landed (label and enclosing text), else null. */
  targets: (ActionTarget | null)[];
  /** Set when only the user can go on (the run waits for a takeover), with the reason to show. */
  handOver: string | null;
}

/** The gate's classification of an action it lets run. */
export interface GateVerdict {
  /** The target the gate classified; a click whose own hit test at dispatch differs is not run. */
  target: TargetDescription | null;
  /** A person (not policy) approved this action on this very element: typing may then run with an incomplete guard. */
  personApproved: boolean;
  /**
   * This click (or Enter) starts a download that was approved: let exactly it through, at the
   * press, bound to whoever approved it (N3).
   */
  allowDownload?: { url: string; approvedBy: string };
}
/** false: do not run; true: run (no classification to hold it to); or the gate's verdict. */
export type ActionGate = (action: ComputerAction) => Promise<boolean | GateVerdict>;

export const FOCUS_MOVED_REFUSAL =
  "Stopped typing: the page moved focus into another part of the page (another frame) while typing, and the rest was not typed there. Look at the screen and decide again.";
export const PAGE_CHANGED_REFUSAL =
  "Stopped typing: the page added or replaced an embedded page (a frame) while typing, and the rest was not typed. Look at the screen and decide again.";
export const UNRESPONSIVE_REFUSAL =
  "Nothing was typed: the page's embedded frames could not all be guarded against misdirected typing (one is not responding, or there are too many). Typing on this page now needs the user's approval: ask for it again as its own step.";
export const TARGET_MOVED_REFUSAL =
  "Nothing was clicked: what is under the pointer changed after the click was checked. Look at the screen and decide again.";
export const UNGUARDED_CLICK_REFUSAL =
  "Nothing was clicked: the page's embedded frames could not all be guarded against the click landing somewhere else (one is not responding, or there are too many). Clicking on this page needs the user's approval: ask for it again as its own step.";
export const PAGE_SETTLING_REFUSAL =
  "Nothing was clicked: the page is still settling (an embedded frame is not responding yet), so the click could not be guarded. Try again in a moment.";
/** Why the run waits for the user when a page has more documents than a click can be guarded in. */
export const PAGE_TOO_COMPLEX =
  "This page has too many embedded frames for the agent to click on it safely. Please take over.";
export const PAGE_TOO_COMPLEX_REFUSAL =
  "Nothing was clicked: this page has too many embedded frames for a click to be guarded, even with approval. The user has been asked to take over.";
export const SECRET_FIELD_REFUSAL =
  "Refused: typing into password, one-time-code or PIN fields is not allowed. Use fill_credential with the vault alias and the field's element ref.";
const TYPE_CHUNK = 24;
/** How long a click waits for frames mid-navigation to commit before it is refused. */
const NAVIGATION_SETTLE_MS = 1_000;
/** How long an approved click waits for every document of the page to arm, and between tries. */
const ARM_SETTLE_MS = 1_000;
const ARM_RETRY_MS = 50;
const SCROLL_STEP = 240;

/** True when the combo would type a character: no Ctrl/Alt/Meta and any non-modifier key is printable. */
function typesText(keys: readonly string[]): boolean {
  const names = keys.map((key) => normalizeCombo([key]));
  if (names.some((name) => ["CTRL", "ALT", "META"].includes(name))) return false;
  return names.some((name) => name !== "SHIFT" && (name.length === 1 || name === "SPACE"));
}

/** The same element by path, label and record (R29-3), and equally (un)inspectable. */
const sameTarget = (a: TargetDescription | null, b: TargetDescription | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.path === b.path &&
    a.label === b.label &&
    a.context === b.context &&
    Boolean(a.opaqueFrame) === Boolean(b.opaqueFrame));

const step = (remaining: number) =>
  Math.sign(remaining) * Math.min(Math.abs(remaining), SCROLL_STEP);
const sameScroll = (a: ScrollState | null, b: ScrollState | null) =>
  a !== null &&
  b !== null &&
  a.chain.length === b.chain.length &&
  a.chain.every((entry, index) => {
    const other = b.chain[index];
    return (
      other !== undefined &&
      entry.key === other.key &&
      Math.abs(entry.top - other.top) < 1 &&
      Math.abs(entry.left - other.left) < 1
    );
  });

/**
 * Executes the allowlisted computer actions as CDP Input through Playwright (spec §6). Coordinates
 * arrive in screenshot pixels and are mapped to CSS pixels; every primitive checks the control
 * guard and the abort signal; every action ends with settle().
 */
export class ComputerExecutor {
  readonly omnibox = new OmniboxEmulator();
  readonly #session: BrowserSession;
  readonly #clock: Clock;
  readonly #waitActionMs: number;
  /** Set when the current action ended in a refusal or no-op note (the batch must stop). */
  #refused = false;
  /** What the action being executed did; handlers that route it elsewhere overwrite it. */
  #effect: ActionEffect = "passive";
  /** The page element the action being executed went to, when known. */
  #target: TargetDescription | null = null;
  /** Set when an action found the page beyond what the agent can act on safely. */
  #handOver: string | null = null;

  constructor(session: BrowserSession, options: { clock: Clock; waitActionMs: number }) {
    this.#session = session;
    this.#clock = options.clock;
    this.#waitActionMs = options.waitActionMs;
  }

  async run(
    actions: readonly ComputerAction[],
    signal: AbortSignal,
    gate: ActionGate = async () => true,
  ): Promise<ComputerRun> {
    const notes: string[] = [];
    const effects: ActionEffect[] = [];
    const targets: (ActionTarget | null)[] = [];
    let executed = 0;
    this.#handOver = null;
    for (const [index, action] of actions.entries()) {
      this.#session.guard.assertAgent(signal);
      const verdict = await gate(action);
      if (!verdict) {
        notes.push(
          `Stopped before action ${index + 1} (${action.type}): it needs the user's approval on the page as it is now. Ask for it again as its own step.`,
        );
        break;
      }
      const urlBefore = this.#session.page.url();
      this.#refused = false;
      this.#effect = PAGE_INPUT.has(action.type) ? "input" : "passive";
      // Typing and keys go to the focused element (a click records its own hit target).
      this.#target =
        (action.type === "type" || action.type === "keypress") && !this.omnibox.active
          ? await focusTarget(this.#session).catch(() => null)
          : null;
      const note = await this.execute(action, signal, verdict === true ? undefined : verdict);
      executed += 1;
      effects.push(this.#effect);
      targets.push(this.#effect === "input" ? actionTarget(this.#target) : null);
      if (note) notes.push(note);
      const remaining = actions.length - index - 1;
      if (this.#refused) {
        // A refusal or no-op means the screen is not what the model assumed; later actions would run blind.
        if (remaining > 0) {
          notes.push(
            `Action ${index + 1} (${action.type}) did not take effect; the remaining ${remaining} action(s) were not run. Look at the screen and decide again.`,
          );
        }
        break;
      }
      if (remaining > 0 && this.#session.page.url() !== urlBefore) {
        notes.push(
          `The page changed after action ${index + 1}; the remaining ${remaining} action(s) were not run. Look at the new screen first.`,
        );
        break;
      }
    }
    return { executed, notes, effects, targets, handOver: this.#handOver };
  }

  async toPage(x: number, y: number): Promise<{ x: number; y: number } | null> {
    const scale = this.#session.lastScale;
    const layout = await this.#session.layout();
    // Whole CSS pixels: the hit test, the browser's own hit test and the click all use this point.
    const px = Math.floor(x / scale);
    const py = Math.floor(y / scale);
    return px >= 0 && py >= 0 && px < layout.width && py < layout.height ? { x: px, y: py } : null;
  }

  /** `verdict`: what the gate classified; without it a click is not held to a target. */
  async execute(
    action: ComputerAction,
    signal: AbortSignal,
    verdict?: GateVerdict,
  ): Promise<string | null> {
    const approved = verdict?.personApproved === true;
    switch (action.type) {
      case "click":
        return this.#click(action.x, action.y, action.button, signal, false, verdict);
      case "double_click":
        return this.#click(action.x, action.y, "left", signal, true, verdict);
      case "move":
        return this.#move(action.x, action.y, signal);
      case "drag":
        return this.#drag(action.path, signal);
      case "scroll":
        return this.#scroll(action, signal);
      case "keypress":
        if (verdict?.allowDownload) {
          const { url: approvedUrl, approvedBy } = verdict.allowDownload;
          await this.#session.downloads.allowOnce((url) => url === approvedUrl, approvedBy);
        }
        return this.#keypress(action.keys, signal, approved);
      case "type":
        return this.#type(action.text, signal, approved);
      case "wait":
        await this.#clock.sleep(this.#waitActionMs, signal);
        await settle(this.#session, signal);
        return null;
      case "screenshot":
        return null;
    }
  }

  #refuse(note: string): string {
    this.#refused = true;
    return note;
  }

  async #outside(x: number, y: number): Promise<string> {
    const layout = await this.#session.layout();
    const scale = this.#session.lastScale;
    return this.#refuse(
      `The point (${x}, ${y}) is outside the visible page (${Math.round(layout.width * scale)}×${Math.round(layout.height * scale)} screenshot pixels); nothing was done.`,
    );
  }

  async #click(
    x: number,
    y: number,
    button: "left" | "right" | "wheel" | "back" | "forward",
    signal: AbortSignal,
    double: boolean,
    verdict: GateVerdict | undefined,
  ): Promise<string | null> {
    this.omnibox.cancel();
    if (button === "back" || button === "forward") return this.#accelerator(button, signal);
    // While the page's own document is being replaced it answers nothing (not even its layout):
    // wait a moment, then refuse rather than stall.
    const loadedBy = Date.now() + NAVIGATION_SETTLE_MS;
    while (this.#session.mainFrameNavigating()) {
      if (Date.now() >= loadedBy) return this.#refuse(PAGE_SETTLING_REFUSAL);
      await pause(25, signal);
    }
    const point = await this.toPage(x, y);
    if (!point) return this.#outside(x, y);
    const mouse = this.#session.page.mouse;
    this.#session.guard.assertAgent(signal);
    await mouse.move(point.x, point.y);
    // A frame mid-navigation near the point refuses the click (its next document is not
    // guarded): give a page whose frames load all the time a moment to settle (a bounded wait,
    // each check bounded too), then check what is under the pointer.
    const navigationSettleBy = Date.now() + NAVIGATION_SETTLE_MS;
    while (await this.#session.navigationNear(point)) {
      if (Date.now() >= navigationSettleBy) return this.#refuse(PAGE_SETTLING_REFUSAL);
      await pause(25, signal);
    }
    const hit = await hitTest(this.#session, point);
    this.#target = hit.target;
    const urlBefore = this.#session.page.url();
    // The page may have changed since the gate classified this click (TOCTOU): if anything
    // differs, nothing is pressed and the model's next click is gated again.
    if (verdict && !sameTarget(verdict.target, markUnguarded(this.#session, hit.target)))
      return this.#refuse(TARGET_MOVED_REFUSAL);
    if (hit.snap) await mouse.move(hit.snap.x, hit.snap.y);
    // Only now that the press will go to the approved link (m6).
    if (verdict?.allowDownload) {
      const { url: approvedUrl, approvedBy } = verdict.allowDownload;
      await this.#session.downloads.allowOnce((url) => url === approvedUrl, approvedBy);
    }
    // ...and from here to the press, the page itself cancels a press that reaches anything but
    // the element just classified. (Inside an uninspectable frame there is none to hold it to:
    // that click was approved as it is.)
    let guard =
      hit.target && !hit.target.opaqueFrame
        ? await armClickGuard(this.#session, signal, hit.key)
        : null;
    let cancelled = false;
    try {
      // A document the guard could not arm (a hung or slow frame) would take an unchecked press:
      // fail closed, as typing does (approval needed). Once a person approved this element, only
      // an unarmed document near the press point holds it back (a frame elsewhere cannot take
      // it): the page gets a moment to settle, then nothing is pressed if one still is.
      const pressAt = hit.snap ?? point;
      const unarmed = () => guard !== null && !guard.complete && !guard.tooMany;
      if (unarmed() && verdict?.personApproved !== true)
        return this.#refuse(UNGUARDED_CLICK_REFUSAL);
      const settleBy = Date.now() + ARM_SETTLE_MS;
      while (unarmed() && (await guard!.unguardedAt(pressAt)) && Date.now() < settleBy) {
        await guard!.disarm();
        await pause(ARM_RETRY_MS, signal);
        guard = await armClickGuard(this.#session, signal, hit.key);
      }
      // Past the document cap nothing is armed, so not even an approved click is safe: the user
      // takes over.
      if (guard?.tooMany) {
        this.#handOver = PAGE_TOO_COMPLEX;
        return this.#refuse(PAGE_TOO_COMPLEX_REFUSAL);
      }
      if (unarmed() && (await guard!.unguardedAt(pressAt)))
        return this.#refuse(PAGE_SETTLING_REFUSAL);
      this.#session.guard.assertAgent(signal);
      const options = {
        button: button === "right" ? "right" : button === "wheel" ? "middle" : "left",
      } as const;
      for (let clickCount = 1; clickCount <= (double ? 2 : 1); clickCount++) {
        // A document added or replaced since arming is not guarded, and an unarmed frame may
        // have moved under the point: press nothing. The geometry is the last check.
        if (guard && (await guard.changedNow(pressAt))) return this.#refuse(TARGET_MOVED_REFUSAL);
        if (unarmed() && (await guard!.unguardedAt(pressAt)))
          return this.#refuse(TARGET_MOVED_REFUSAL);
        await mouse.down({ ...options, clickCount });
        await mouse.up({ ...options, clickCount });
      }
    } finally {
      if (signal.aborted) void guard?.disarm();
      else cancelled = (await guard?.disarm()) ?? false;
    }
    if (cancelled) return this.#refuse(TARGET_MOVED_REFUSAL);
    await settle(this.#session, signal);
    if (hit.target?.disclosure && this.#session.page.url() === urlBefore)
      this.#effect = "disclosure";
    return null;
  }

  async #move(x: number, y: number, signal: AbortSignal): Promise<string | null> {
    const point = await this.toPage(x, y);
    if (!point) return this.#outside(x, y);
    this.#session.guard.assertAgent(signal);
    await this.#session.page.mouse.move(point.x, point.y, { steps: 5 });
    await pause(100, signal);
    await settle(this.#session, signal);
    return null;
  }

  async #drag(
    path: ReadonlyArray<{ x: number; y: number }>,
    signal: AbortSignal,
  ): Promise<string | null> {
    this.omnibox.cancel();
    const points: Array<{ x: number; y: number }> = [];
    for (const raw of path) {
      const point = await this.toPage(raw.x, raw.y);
      if (!point) return this.#outside(raw.x, raw.y);
      points.push(point);
    }
    const [first, ...rest] = points;
    if (!first) return null;
    const mouse = this.#session.page.mouse;
    this.#session.guard.assertAgent(signal);
    await mouse.move(first.x, first.y);
    await mouse.down();
    try {
      for (const point of rest) {
        this.#session.guard.assertAgent(signal);
        await mouse.move(point.x, point.y, { steps: 5 });
      }
    } finally {
      // Never leave the button down after an abort, a takeover or a failed move.
      await mouse.up().catch(() => undefined);
    }
    await settle(this.#session, signal);
    return null;
  }

  async #scroll(
    action: Extract<ComputerAction, { type: "scroll" }>,
    signal: AbortSignal,
  ): Promise<string | null> {
    this.omnibox.cancel();
    const point = await this.toPage(action.x, action.y);
    if (!point) return this.#outside(action.x, action.y);
    const scale = this.#session.lastScale;
    let dx = Math.round(action.scroll_x / scale);
    let dy = Math.round(action.scroll_y / scale);
    const before = await scrollState(this.#session, point);
    this.#session.guard.assertAgent(signal);
    await this.#session.page.mouse.move(point.x, point.y);
    while (dx !== 0 || dy !== 0) {
      this.#session.guard.assertAgent(signal);
      const sx = step(dx);
      const sy = step(dy);
      await this.#session.page.mouse.wheel(sx, sy);
      dx -= sx;
      dy -= sy;
      await pause(16, signal);
    }
    let after = await scrollState(this.#session, point);
    for (let i = 0; i < 10; i++) {
      await pause(50, signal);
      const next = await scrollState(this.#session, point);
      if (sameScroll(next, after)) break;
      after = next;
    }
    await settle(this.#session, signal, { maxQuietMs: 500 });
    if (sameScroll(before, after)) {
      return this.#refuse(
        `Scrolling at (${action.x}, ${action.y}) had no effect: that area is already at its edge or cannot scroll. Try another spot or direction.`,
      );
    }
    return null;
  }

  /** A refusal for the focused element, or null when typing into it is allowed. */
  #typingRefusal(focus: TargetDescription | null): string | null {
    if (focus?.isSecretField) return this.#refuse(SECRET_FIELD_REFUSAL);
    if (!focus?.editable) {
      return this.#refuse(
        "Nothing editable has focus, so nothing was typed. Click the field first.",
      );
    }
    return null;
  }

  async #type(text: string, signal: AbortSignal, approved: boolean): Promise<string | null> {
    if (this.omnibox.active) {
      this.omnibox.type(text);
      this.#effect = "address_bar";
      return null;
    }
    if (text.includes("\t")) {
      return this.#refuse(
        "Tab characters cannot be typed: they move focus to another field. Type each field's text separately and press TAB with keypress.",
      );
    }
    let refusal = this.#typingRefusal(await focusTarget(this.#session));
    if (refusal) return refusal;
    const guard = await armTypingGuard(this.#session, signal);
    try {
      // A document that could not be armed fails closed (approval needed), unless a person
      // approved this action.
      if (!guard.complete && !approved) return this.#refuse(UNRESPONSIVE_REFUSAL);
      const chars = [...text];
      for (let offset = 0; offset < chars.length; offset += TYPE_CHUNK) {
        // Focus can move while typing (auto-advance fields): check before every chunk.
        if (offset > 0) {
          refusal = this.#typingRefusal(await focusTarget(this.#session));
          if (refusal) return refusal;
        }
        // One character at a time: a document that appears mid-chunk is not armed, so typing
        // stops before the next character.
        for (const char of chars.slice(offset, offset + TYPE_CHUNK)) {
          this.#session.guard.assertAgent(signal);
          if (guard.changed) return this.#refuse(PAGE_CHANGED_REFUSAL);
          await this.#session.page.keyboard.type(char);
        }
        if (guard.changed) return this.#refuse(PAGE_CHANGED_REFUSAL);
        // A page script moved focus into another document mid-chunk: the rest was cancelled
        // there by the guard; stop and let the model look again.
        if (await guard.focusMoved()) return this.#refuse(FOCUS_MOVED_REFUSAL);
      }
      const focus = await focusTarget(this.#session);
      if (focus?.isSecretField) return this.#refuse(SECRET_FIELD_REFUSAL);
    } finally {
      if (signal.aborted) void guard.disarm();
      else await guard.disarm();
    }
    await settle(this.#session, signal);
    return null;
  }

  async #keypress(
    keys: readonly string[],
    signal: AbortSignal,
    approved: boolean,
  ): Promise<string | null> {
    if (this.omnibox.active) {
      const combo = normalizeCombo(keys);
      if (combo === "ENTER") {
        this.#effect = "address_bar";
        const url = this.omnibox.take();
        if (!url) return this.#refuse("That is not a valid http(s) URL; nothing was opened.");
        const opened = await this.#session.goto(url, signal);
        if (!opened) return this.#refuse(`Could not open ${url}.`);
        await settle(this.#session, signal);
        if (sameDocument(this.#session.page.url(), url)) this.#effect = "address_bar_landed";
        return null;
      }
      if (combo === "ESC") {
        this.omnibox.cancel();
        this.#effect = "address_bar";
        return null;
      }
      if (combo === "BACKSPACE") {
        this.omnibox.backspace();
        this.#effect = "address_bar";
        return null;
      }
      if (combo === "CTRL+A" || combo === "META+A") {
        this.omnibox.clear();
        this.#effect = "address_bar";
        return null;
      }
      this.omnibox.cancel();
    }
    const accelerator = matchAccelerator(keys);
    if (accelerator) return this.#accelerator(accelerator, signal);
    let combo: string;
    try {
      combo = toPlaywrightCombo(keys);
    } catch (error) {
      if (error instanceof UnknownKey)
        return this.#refuse(`${error.message}; nothing was pressed.`);
      throw error;
    }
    this.#session.guard.assertAgent(signal);
    // Printable keys type characters: refuse them in a secret field like `type` does. Any key
    // aimed at an editable element runs with the typing guard armed.
    const focus = await focusTarget(this.#session);
    const typing = typesText(keys);
    if (typing && focus?.isSecretField) return this.#refuse(SECRET_FIELD_REFUSAL);
    if (focus?.editable || focus?.isSecretField) {
      const guard = await armTypingGuard(this.#session, signal);
      try {
        if (typing && !guard.complete && !approved) return this.#refuse(UNRESPONSIVE_REFUSAL);
        this.#session.guard.assertAgent(signal);
        await this.#session.page.keyboard.press(combo);
      } finally {
        if (signal.aborted) void guard.disarm();
        else await guard.disarm();
      }
    } else {
      await this.#session.page.keyboard.press(combo);
    }
    await settle(this.#session, signal);
    return null;
  }

  async #accelerator(kind: Accelerator, signal: AbortSignal): Promise<string | null> {
    const page = this.#session.page;
    this.#session.guard.assertAgent(signal);
    if (kind === "back" || kind === "forward" || kind === "reload") this.#effect = "navigate";
    if (kind === "address_bar") this.#effect = "address_bar";
    switch (kind) {
      case "back":
      case "forward": {
        const options = { waitUntil: "domcontentloaded" as const, timeout: 15_000 };
        const response = await (
          kind === "back" ? page.goBack(options) : page.goForward(options)
        ).catch(() => null);
        await settle(this.#session, signal);
        return response === null && page.url() === "about:blank"
          ? this.#refuse(`There is no page to go ${kind} to.`)
          : null;
      }
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
        await settle(this.#session, signal);
        return null;
      case "address_bar":
        this.omnibox.open();
        return "Address bar focused: type the full URL, then press ENTER.";
      case "new_tab":
      case "close_tab":
        return this.#refuse(
          "Tabs are managed automatically. Use CTRL+L to open a URL in the current tab.",
        );
    }
  }
}

/** Actions that reach the page unless the executor routes them elsewhere (address bar, history). */
const PAGE_INPUT: ReadonlySet<ComputerAction["type"]> = new Set([
  "click",
  "double_click",
  "drag",
  "keypress",
  "type",
]);

/** The same document: origin and path, ignoring query, hash and a trailing slash. */
function sameDocument(a: string, b: string): boolean {
  const norm = (u: string) => {
    const url = new URL(u);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

/** What grading needs of a target: its label and the opening text of its enclosing elements. */
function actionTarget(target: TargetDescription | null): ActionTarget | null {
  return target ? { label: target.label, ancestors: target.ancestors ?? [] } : null;
}
