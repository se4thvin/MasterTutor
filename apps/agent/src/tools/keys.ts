const ALIASES: Record<string, string> = {
  CONTROL: "CTRL",
  CMD: "META",
  COMMAND: "META",
  SUPER: "META",
  WIN: "META",
  OPTION: "ALT",
  RETURN: "ENTER",
  ESCAPE: "ESC",
  DEL: "DELETE",
  PGUP: "PAGEUP",
  PGDN: "PAGEDOWN",
  UP: "ARROWUP",
  DOWN: "ARROWDOWN",
  LEFT: "ARROWLEFT",
  RIGHT: "ARROWRIGHT",
};
const MODIFIER_ORDER = ["CTRL", "ALT", "SHIFT", "META"];
const PLAYWRIGHT: Record<string, string> = {
  CTRL: "Control",
  ALT: "Alt",
  SHIFT: "Shift",
  META: "Meta",
  ENTER: "Enter",
  ESC: "Escape",
  SPACE: "Space",
  TAB: "Tab",
  BACKSPACE: "Backspace",
  DELETE: "Delete",
  INSERT: "Insert",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  ARROWUP: "ArrowUp",
  ARROWDOWN: "ArrowDown",
  ARROWLEFT: "ArrowLeft",
  ARROWRIGHT: "ArrowRight",
};

export class UnknownKey extends Error {
  constructor(key: string) {
    super(`Unknown key: ${key.slice(0, 32)}`);
    this.name = "UnknownKey";
  }
}

function canonical(key: string): string {
  const upper = key.trim().toUpperCase();
  return ALIASES[upper] ?? upper;
}

/** A stable combo name such as "CTRL+L" or "ALT+ARROWLEFT", modifiers first. */
export function normalizeCombo(keys: readonly string[]): string {
  const names = keys.map(canonical);
  const modifiers = MODIFIER_ORDER.filter((modifier) => names.includes(modifier));
  const rest = names.filter((name) => !MODIFIER_ORDER.includes(name));
  return [...modifiers, ...rest].join("+");
}

export function toPlaywrightKey(key: string): string {
  const name = canonical(key);
  const mapped = PLAYWRIGHT[name];
  if (mapped) return mapped;
  if (/^F([1-9]|1[0-2])$/.test(name)) return name;
  if (/^[A-Z]$/.test(name)) return `Key${name}`;
  if (/^[0-9]$/.test(name)) return `Digit${name}`;
  if (key.length === 1) return key;
  throw new UnknownKey(key);
}

export function toPlaywrightCombo(keys: readonly string[]): string {
  return keys.map(toPlaywrightKey).join("+");
}
