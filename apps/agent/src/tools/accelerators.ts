import { normalizeCombo } from "./keys.ts";

/**
 * CDP input reaches only the page, never Chromium's own UI, so browser shortcuts the model has
 * learned on desktops do nothing. The executor emulates the useful ones (generic, not site-specific).
 */
export type Accelerator = "back" | "forward" | "reload" | "address_bar" | "new_tab" | "close_tab";

const COMBOS: Record<string, Accelerator> = {
  "ALT+ARROWLEFT": "back",
  "META+[": "back",
  BROWSERBACK: "back",
  "ALT+ARROWRIGHT": "forward",
  "META+]": "forward",
  BROWSERFORWARD: "forward",
  F5: "reload",
  "CTRL+R": "reload",
  "META+R": "reload",
  "CTRL+L": "address_bar",
  "META+L": "address_bar",
  "ALT+D": "address_bar",
  F6: "address_bar",
  "CTRL+T": "new_tab",
  "META+T": "new_tab",
  "CTRL+W": "close_tab",
  "META+W": "close_tab",
};

export function matchAccelerator(keys: readonly string[]): Accelerator | null {
  return COMBOS[normalizeCombo(keys)] ?? null;
}

export function normalizeTypedUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The emulated address bar: CTRL+L opens it, `type` fills it, ENTER navigates, ESC cancels. */
export class OmniboxEmulator {
  #active = false;
  #buffer = "";

  get active(): boolean {
    return this.#active;
  }

  open(): void {
    this.#active = true;
    this.#buffer = "";
  }

  type(text: string): void {
    this.#buffer += text;
  }

  backspace(): void {
    this.#buffer = this.#buffer.slice(0, -1);
  }

  clear(): void {
    this.#buffer = "";
  }

  cancel(): void {
    this.#active = false;
    this.#buffer = "";
  }

  take(): string | null {
    const url = normalizeTypedUrl(this.#buffer);
    this.cancel();
    return url;
  }
}
