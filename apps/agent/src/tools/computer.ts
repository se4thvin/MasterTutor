import type { ComputerAction } from "@mastertutor/contracts";
import {
  armSecretBlock,
  disarmSecretBlock,
  focusTarget,
  hitTest,
  scrollState,
  type ScrollState,
} from "../browser/hit-test.ts";
import type { TargetDescription } from "../browser/page-helpers.ts";
import type { BrowserSession } from "../browser/session.ts";
import { settle } from "../browser/settle.ts";
import { pause } from "../runtime/abortable.ts";
import type { Clock } from "../runtime/clock.ts";
import { OmniboxEmulator, matchAccelerator, type Accelerator } from "./accelerators.ts";
import { UnknownKey, normalizeCombo, toPlaywrightCombo } from "./keys.ts";

export interface ComputerRun {
  executed: number;
  notes: string[];
}

export type ActionGate = (action: ComputerAction) => Promise<boolean>;

export const SECRET_FIELD_REFUSAL =
  "Refused: typing into password, one-time-code or PIN fields is not allowed. Use fill_credential with the vault alias and the field's element ref.";
const TYPE_CHUNK = 24;
const SCROLL_STEP = 240;

/** One printable key, optionally with Shift: it would type a character into the focused field. */
function isPrintable(keys: readonly string[]): boolean {
  const names = keys.map((key) => normalizeCombo([key]));
  if (names.some((name) => ["CTRL", "ALT", "META"].includes(name))) return false;
  const rest = names.filter((name) => name !== "SHIFT");
  return rest.length === 1 && (rest[0]?.length === 1 || rest[0] === "SPACE");
}

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
    let executed = 0;
    for (const [index, action] of actions.entries()) {
      this.#session.guard.assertAgent(signal);
      if (!(await gate(action))) {
        notes.push(
          `Stopped before action ${index + 1} (${action.type}): it needs the user's approval on the page as it is now. Ask for it again as its own step.`,
        );
        break;
      }
      const urlBefore = this.#session.page.url();
      this.#refused = false;
      const note = await this.execute(action, signal);
      executed += 1;
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
    return { executed, notes };
  }

  async toPage(x: number, y: number): Promise<{ x: number; y: number } | null> {
    const scale = this.#session.lastScale;
    const layout = await this.#session.layout();
    const px = x / scale;
    const py = y / scale;
    return px >= 0 && py >= 0 && px < layout.width && py < layout.height ? { x: px, y: py } : null;
  }

  async execute(action: ComputerAction, signal: AbortSignal): Promise<string | null> {
    switch (action.type) {
      case "click":
        return this.#click(action.x, action.y, action.button, signal, false);
      case "double_click":
        return this.#click(action.x, action.y, "left", signal, true);
      case "move":
        return this.#move(action.x, action.y, signal);
      case "drag":
        return this.#drag(action.path, signal);
      case "scroll":
        return this.#scroll(action, signal);
      case "keypress":
        return this.#keypress(action.keys, signal);
      case "type":
        return this.#type(action.text, signal);
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
  ): Promise<string | null> {
    this.omnibox.cancel();
    if (button === "back" || button === "forward") return this.#accelerator(button, signal);
    const point = await this.toPage(x, y);
    if (!point) return this.#outside(x, y);
    const hit = await hitTest(this.#session, point);
    const at = hit.snap ?? point;
    this.#session.guard.assertAgent(signal);
    const mouse = this.#session.page.mouse;
    if (double) await mouse.dblclick(at.x, at.y);
    else
      await mouse.click(at.x, at.y, {
        button: button === "right" ? "right" : button === "wheel" ? "middle" : "left",
      });
    await settle(this.#session, signal);
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

  async #type(text: string, signal: AbortSignal): Promise<string | null> {
    if (this.omnibox.active) {
      this.omnibox.type(text);
      return null;
    }
    if (text.includes("\t")) {
      return this.#refuse(
        "Tab characters cannot be typed: they move focus to another field. Type each field's text separately and press TAB with keypress.",
      );
    }
    let refusal = this.#typingRefusal(await focusTarget(this.#session));
    if (refusal) return refusal;
    await armSecretBlock(this.#session);
    try {
      for (let offset = 0; offset < text.length; offset += TYPE_CHUNK) {
        this.#session.guard.assertAgent(signal);
        // Focus can move while typing (auto-advance fields): check before every chunk.
        if (offset > 0) {
          refusal = this.#typingRefusal(await focusTarget(this.#session));
          if (refusal) return refusal;
        }
        await this.#session.page.keyboard.type(text.slice(offset, offset + TYPE_CHUNK));
      }
      const focus = await focusTarget(this.#session);
      if (focus?.isSecretField) return this.#refuse(SECRET_FIELD_REFUSAL);
    } finally {
      await disarmSecretBlock(this.#session);
    }
    await settle(this.#session, signal);
    return null;
  }

  async #keypress(keys: readonly string[], signal: AbortSignal): Promise<string | null> {
    if (this.omnibox.active) {
      const combo = normalizeCombo(keys);
      if (combo === "ENTER") {
        const url = this.omnibox.take();
        if (!url) return this.#refuse("That is not a valid http(s) URL; nothing was opened.");
        const opened = await this.#session.goto(url, signal);
        if (!opened) return this.#refuse(`Could not open ${url}.`);
        await settle(this.#session, signal);
        return null;
      }
      if (combo === "ESC") {
        this.omnibox.cancel();
        return null;
      }
      if (combo === "BACKSPACE") {
        this.omnibox.backspace();
        return null;
      }
      if (combo === "CTRL+A" || combo === "META+A") {
        this.omnibox.clear();
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
    if (isPrintable(keys)) {
      // A lone printable key types a character: refuse it in a secret field like `type` does.
      if ((await focusTarget(this.#session))?.isSecretField)
        return this.#refuse(SECRET_FIELD_REFUSAL);
      await armSecretBlock(this.#session);
      try {
        await this.#session.page.keyboard.press(combo);
      } finally {
        await disarmSecretBlock(this.#session);
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
