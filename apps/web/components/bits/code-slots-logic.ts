/** SubmitOtpInput accepts 4–8 digits (Phase 0 dto.ts). */
const OTP_MIN_DIGITS = 4;
const OTP_MAX_DIGITS = 8;
export const OTP_DEFAULT_DIGITS = 6;

export interface SlotsState {
  slots: string[];
  active: number;
}

export function digitsOf(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function emptySlots(length: number): string[] {
  return Array.from({ length }, () => "");
}

export function typeDigits(state: SlotsState, raw: string): SlotsState {
  const digits = digitsOf(raw);
  if (!digits) return state;
  const slots = state.slots.slice();
  let i = state.active;
  for (const digit of digits) {
    if (i >= slots.length) break;
    slots[i] = digit;
    i++;
  }
  return { slots, active: Math.min(i, slots.length - 1) };
}

/** A whole code (paste or OS autofill) replaces the boxes and sizes them to the code. */
export function pasteDigits(state: SlotsState, raw: string): SlotsState {
  const digits = digitsOf(raw);
  if (digits.length >= OTP_MIN_DIGITS && digits.length <= OTP_MAX_DIGITS) {
    return { slots: digits.split(""), active: digits.length - 1 };
  }
  return typeDigits(state, digits);
}

export function backspace(state: SlotsState): SlotsState {
  const slots = state.slots.slice();
  if (slots[state.active]) {
    slots[state.active] = "";
    return { slots, active: state.active };
  }
  const prev = Math.max(0, state.active - 1);
  slots[prev] = "";
  return { slots, active: prev };
}

export function isComplete(slots: readonly string[]): boolean {
  return slots.length >= OTP_MIN_DIGITS && slots.every((s) => s !== "");
}
