import { describe, expect, it } from "vitest";
import {
  backspace,
  digitsOf,
  emptySlots,
  isComplete,
  pasteDigits,
  typeDigits,
} from "./code-slots-logic.ts";

const fresh = () => ({ slots: emptySlots(6), active: 0 });

describe("code slots logic", () => {
  it("types digits left to right and completes on the last box", () => {
    let s = fresh();
    for (const d of "48151") s = typeDigits(s, d);
    expect(s).toEqual({ slots: ["4", "8", "1", "5", "1", ""], active: 5 });
    expect(isComplete(s.slots)).toBe(false);
    s = typeDigits(s, "6");
    expect(isComplete(s.slots)).toBe(true);
    expect(s.slots.join("")).toBe("481516");
  });

  it("accepts pasted or autofilled codes with spaces or dashes", () => {
    expect(pasteDigits(fresh(), "123 456").slots.join("")).toBe("123456");
    expect(pasteDigits(fresh(), "12-34-56").slots.join("")).toBe("123456");
    expect(digitsOf("Your code: 9 9 1 2")).toBe("9912");
  });

  it("resizes for 4–8 digit codes", () => {
    const eight = pasteDigits(fresh(), "12345678");
    expect(eight.slots).toHaveLength(8);
    expect(isComplete(eight.slots)).toBe(true);
    expect(pasteDigits(fresh(), "4321").slots).toHaveLength(4);
  });

  it("fills from the caret when the paste is too short or too long to be a code", () => {
    expect(pasteDigits(fresh(), "12").slots.join("")).toBe("12");
    expect(pasteDigits(fresh(), "123456789").slots.join("")).toBe("123456");
  });

  it("deletes backwards", () => {
    let s = typeDigits(typeDigits(fresh(), "1"), "2");
    s = backspace(s);
    expect(s).toEqual({ slots: ["1", "", "", "", "", ""], active: 1 });
    s = backspace(s);
    expect(s).toEqual({ slots: emptySlots(6), active: 0 });
  });
});
