import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { marquee } from "@/lib/motion-tokens.ts";
import { glide, marqueeAction, measureMarquee, travelMs } from "./marquee.ts";
import { MarqueeText } from "./marquee-text.tsx";

const NAME = "Quarterly reading list for advanced distributed systems and consensus papers";

describe("MarqueeText: truncation detection", () => {
  it("a label that fits is not truncated and never moves", () => {
    expect(measureMarquee(200, 120, 16)).toEqual({ overflowing: false, shift: 0 });
    expect(measureMarquee(200, 200.8, 16)).toEqual({ overflowing: false, shift: 0 });
  });

  it("a label wider than its box glides its overflow plus the fade, so the end clears it", () => {
    expect(measureMarquee(200, 340, 16)).toEqual({ overflowing: true, shift: 156 });
  });

  it("a box with no width yet (hidden, not laid out) is never truncated", () => {
    expect(measureMarquee(0, 340, 16)).toEqual({ overflowing: false, shift: 0 });
  });
});

describe("MarqueeText: hover and focus behaviour", () => {
  it("hover and keyboard focus both glide a truncated label", () => {
    expect(marqueeAction(true, false, "hover")).toBe("glide");
    expect(marqueeAction(true, false, "focus")).toBe("glide");
  });

  it("a label that fits does nothing on hover or focus", () => {
    expect(marqueeAction(false, false, "hover")).toBe("none");
    expect(marqueeAction(false, true, "focus")).toBe("none");
  });

  it("under reduced motion nothing moves: focus shows the tooltip, hover keeps the title", () => {
    expect(marqueeAction(true, true, "focus")).toBe("tooltip");
    expect(marqueeAction(true, true, "hover")).toBe("none");
  });
});

describe("MarqueeText: the glide", () => {
  it("moves at a reading pace, clamped for short and very long names", () => {
    expect(travelMs(90)).toBe(2000);
    expect(travelMs(4)).toBe(marquee.minTravelMs);
    expect(travelMs(10_000)).toBe(marquee.maxTravelMs);
  });

  it("rests, travels to the end, rests and returns, with transform keyframes only", () => {
    const { keyframes, durationMs } = glide(90, false);
    expect(durationMs).toBe(2 * marquee.holdMs + 2 * 2000);
    expect(keyframes.map((k) => k["transform"])).toEqual([
      "translateX(0)",
      "translateX(0)",
      "translateX(-90px)",
      "translateX(-90px)",
      "translateX(0)",
    ]);
    for (const frame of keyframes) {
      expect(
        Object.keys(frame).filter((k) => !["offset", "transform", "easing"].includes(k)),
      ).toEqual([]);
    }
    const offsets = keyframes.map((k) => k.offset ?? -1);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets.at(-1)).toBe(1);
  });

  it("glides the other way in right-to-left text", () => {
    expect(glide(90, true).keyframes[2]?.["transform"]).toBe("translateX(90px)");
  });
});

describe("MarqueeText: markup", () => {
  const html = renderToStaticMarkup(createElement(MarqueeText, { text: NAME, className: "x" }));

  it("always carries the full name in title and as its text", () => {
    expect(html).toContain(`title="${NAME}"`);
    expect(html).toContain(`>${NAME}</span>`);
  });

  it("is a deliberate clip for layout QA, and the moving text is not hidden from readers", () => {
    expect(html).toMatch(/^<span class="marquee x" [^>]*data-qa-allow-clip=""/);
    expect(html).not.toContain("aria-hidden");
  });

  it("starts at rest: no truncation flag until it is measured in the browser", () => {
    expect(html).not.toContain("data-overflow");
  });

  it("checks reduced motion at the moment of the glide, since WAAPI ignores motion.css", () => {
    const source = readFileSync(new URL("./marquee-text.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  });
});
