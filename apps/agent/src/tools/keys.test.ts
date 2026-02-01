import { describe, expect, it } from "vitest";
import { OmniboxEmulator, matchAccelerator, normalizeTypedUrl } from "./accelerators.ts";
import { UnknownKey, normalizeCombo, toPlaywrightCombo } from "./keys.ts";

describe("keys", () => {
  it("maps OpenAI key names to Playwright combos", () => {
    expect(toPlaywrightCombo(["CTRL", "A"])).toBe("Control+KeyA");
    expect(toPlaywrightCombo(["ENTER"])).toBe("Enter");
    expect(toPlaywrightCombo(["shift", "tab"])).toBe("Shift+Tab");
    expect(toPlaywrightCombo(["SPACE"])).toBe("Space");
    expect(toPlaywrightCombo(["PGDN"])).toBe("PageDown");
    expect(toPlaywrightCombo(["F5"])).toBe("F5");
    expect(toPlaywrightCombo(["1"])).toBe("Digit1");
    expect(() => toPlaywrightCombo(["HYPERDRIVE"])).toThrow(UnknownKey);
  });
  it("names whitespace keys, so a raw newline or space can never pass as no key (N2 audit)", () => {
    for (const key of ["\n", "\r", "\r\n", "Return", "NumpadEnter", "KP_Enter"])
      expect(normalizeCombo([key])).toBe("ENTER");
    expect(normalizeCombo([" "])).toBe("SPACE");
    expect(normalizeCombo(["shift", "\r"])).toBe("SHIFT+ENTER");
    for (const key of ["\n", "\r", "\r\n", "NumpadEnter"])
      expect(toPlaywrightCombo([key])).toBe("Enter");
    expect(toPlaywrightCombo([" "])).toBe("Space");
  });
  it("normalizes combos with modifiers first", () => {
    expect(normalizeCombo(["l", "control"])).toBe("CTRL+L");
    expect(normalizeCombo(["Left", "Alt"])).toBe("ALT+ARROWLEFT");
  });
});

describe("browser shortcuts", () => {
  it("recognizes history, reload and the address bar", () => {
    expect(matchAccelerator(["ALT", "LEFT"])).toBe("back");
    expect(matchAccelerator(["CMD", "["])).toBe("back");
    expect(matchAccelerator(["F5"])).toBe("reload");
    expect(matchAccelerator(["CTRL", "L"])).toBe("address_bar");
    expect(matchAccelerator(["CTRL", "T"])).toBe("new_tab");
    expect(matchAccelerator(["CTRL", "C"])).toBeNull();
  });
  it("normalizes typed URLs and rejects other schemes", () => {
    expect(normalizeTypedUrl(" learn.zybooks.com/zybook/X ")).toBe(
      "https://learn.zybooks.com/zybook/X",
    );
    expect(normalizeTypedUrl("http://site.fixtures.test/page2")).toBe(
      "http://site.fixtures.test/page2",
    );
    expect(normalizeTypedUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeTypedUrl("")).toBeNull();
  });
  it("buffers typing while the emulated address bar is open", () => {
    const omnibox = new OmniboxEmulator();
    omnibox.open();
    omnibox.type("site.fixtures.tesx");
    omnibox.backspace();
    omnibox.type("t");
    expect(omnibox.take()).toBe("https://site.fixtures.test/");
    expect(omnibox.active).toBe(false);
  });
});
