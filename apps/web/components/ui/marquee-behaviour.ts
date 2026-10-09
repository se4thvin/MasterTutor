import { marquee } from "@/lib/motion-tokens.ts";
import { glide, marqueeAction, measureMarquee, type MarqueeMeasure } from "./marquee.ts";

const SETTLE_EASING = `cubic-bezier(${marquee.easing.join(", ")})`;

/**
 * MarqueeText's behaviour, loaded after first paint (it is not needed to draw the label): measures
 * the label, flags it [data-overflow] (the fade), and glides it on hover or keyboard focus of its
 * host (the nearest [data-marquee-host], else its parent). The glide is a WAAPI transform on the
 * text alone: compositor-only, zero layout (D28). WAAPI ignores motion.css, so reduced motion is
 * read here: nothing moves, and keyboard focus shows the full name in a tooltip instead.
 * Returns the cleanup.
 */
export function attachMarquee(box: HTMLElement, inner: HTMLElement, text: string): () => void {
  // The fade's width comes from CSS (.marquee --marquee-fade); the glide travels past it.
  const fade = Number.parseFloat(getComputedStyle(box).getPropertyValue("--marquee-fade")) || 0;
  let measure: MarqueeMeasure = { overflowing: false, shift: 0 };
  const remeasure = () => {
    measure = measureMarquee(box.clientWidth, inner.scrollWidth, fade);
    box.toggleAttribute("data-overflow", measure.overflowing);
  };
  const observer = new ResizeObserver(remeasure);
  observer.observe(box);

  const host = box.closest<HTMLElement>("[data-marquee-host]") ?? box.parentElement ?? box;
  let hovered = false;
  let focused = false;
  let running: Animation | null = null;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const start = (via: "hover" | "focus") => {
    const action = marqueeAction(measure.overflowing, reducedMotion(), via);
    if (action === "tooltip") showTip(box, text);
    if (action !== "glide" || running?.playState === "running") return;
    running?.cancel();
    const { keyframes, durationMs } = glide(
      measure.shift,
      getComputedStyle(box).direction === "rtl",
    );
    running = inner.animate(keyframes, { duration: durationMs });
  };
  const stop = () => {
    // The tooltip belongs to keyboard focus alone (hover has the title).
    if (!focused) hideTip(box);
    if (hovered || focused) return;
    if (running?.playState !== "running") return;
    // Ease back from wherever it is, rather than snapping to the start.
    const from = getComputedStyle(inner).transform;
    running.cancel();
    running = inner.animate([{ transform: from }, { transform: "translateX(0)" }], {
      duration: marquee.settleMs,
      easing: SETTLE_EASING,
    });
  };
  const onEnter = () => {
    hovered = true;
    start("hover");
  };
  const onLeave = () => {
    hovered = false;
    stop();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
    focused = true;
    start("focus");
  };
  const onFocusOut = () => {
    focused = false;
    stop();
  };
  host.addEventListener("pointerenter", onEnter);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("focusin", onFocusIn);
  host.addEventListener("focusout", onFocusOut);
  return () => {
    observer.disconnect();
    host.removeEventListener("pointerenter", onEnter);
    host.removeEventListener("pointerleave", onLeave);
    host.removeEventListener("focusin", onFocusIn);
    host.removeEventListener("focusout", onFocusOut);
    running?.cancel();
    hideTip(box);
  };
}

/*
 * The reduced-motion tooltip: one element for the page, in the top layer (popover), laid over the
 * truncated label like a macOS expansion tooltip. It repeats visible text, so it is aria-hidden.
 */
let tip: HTMLDivElement | null = null;
let tipOwner: Element | null = null;

function showTip(anchor: HTMLElement, text: string) {
  if (typeof HTMLElement.prototype.showPopover !== "function") return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "marquee-tip";
    tip.popover = "manual";
    tip.setAttribute("aria-hidden", "true");
  }
  if (!tip.isConnected) document.body.append(tip);
  const box = anchor.getBoundingClientRect();
  const style = getComputedStyle(anchor);
  tip.textContent = text;
  tip.style.font = style.font;
  tip.style.letterSpacing = style.letterSpacing;
  // The tip's text starts exactly where the label's does.
  const left = Math.max(8, box.left - Number.parseFloat(getComputedStyle(tip).paddingLeft));
  tip.style.left = `${left}px`;
  tip.style.maxWidth = `${window.innerWidth - left - 8}px`;
  if (!tip.matches(":popover-open")) tip.showPopover();
  tip.style.top = `${box.top + box.height / 2 - tip.offsetHeight / 2}px`;
  tipOwner = anchor;
  window.addEventListener("scroll", hideOnScroll, { capture: true, once: true });
}

function hideTip(anchor: Element) {
  if (tipOwner !== anchor || !tip) return;
  tipOwner = null;
  if (tip.matches(":popover-open")) tip.hidePopover();
}

function hideOnScroll() {
  if (tipOwner) hideTip(tipOwner);
}
