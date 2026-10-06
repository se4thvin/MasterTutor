import type { Page } from "@playwright/test";

/*
 * Motion assertions for e2e tests. To wait for layout animation, wait for
 * html[data-layout-motion=ready]; that marker is document-global (the first <LayoutMotion> to load
 * sets it), so it proves the features chunk is cached, not that a particular boundary rendered.
 */

const MOVING = ["transform", "translate", "scale", "rotate"];
type SampleStore = { __samples?: Record<string, string[]> };

/**
 * Animations and transitions (CSS or WAAPI) longer than 1ms, on elements inside `selector`, whose
 * keyframes move something. Under reduced motion this must be [] (motion.css cuts animations to
 * 1ms and transitions to opacity). Motion's rAF springs are not listed; sample those instead.
 */
export async function movingAnimations(page: Page, selector: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, moving }) => {
      const scopes = [...document.querySelectorAll(selector)];
      return document.getAnimations().flatMap((animation) => {
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (!effect || !(target instanceof Element) || !scopes.some((s) => s.contains(target)))
          return [];
        if (Number(effect.getComputedTiming().duration ?? 0) <= 1) return [];
        const moves = effect
          .getKeyframes()
          .some((frame) => moving.some((p) => p in frame && frame[p] !== "none"));
        if (!moves) return [];
        const name =
          (animation as CSSAnimation).animationName ??
          (animation as CSSTransition).transitionProperty ??
          "script";
        return [`${name} on ${target.className}`];
      });
    },
    { selector, moving: MOVING },
  );
}

/** Records getComputedStyle(first match)[property] once per frame, `frames` times, under `key`. */
export async function startSampling(
  page: Page,
  key: string,
  selector: string,
  property: string,
  frames = 45,
): Promise<void> {
  await page.evaluate(
    ({ key, selector, property, frames }) => {
      const store = ((window as SampleStore).__samples ??= {});
      const out: string[] = (store[key] = []);
      const tick = () => {
        const el = document.querySelector(selector);
        out.push(el ? getComputedStyle(el).getPropertyValue(property) : "");
        if (out.length < frames) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { key, selector, property, frames },
  );
}

export async function readSamples(page: Page, key: string, frames = 45): Promise<string[]> {
  await page.waitForFunction(
    ({ key, frames }) => ((window as SampleStore).__samples?.[key]?.length ?? 0) >= frames,
    { key, frames },
  );
  return page.evaluate((key) => (window as SampleStore).__samples?.[key] ?? [], key);
}

/** A computed transform that is not the identity. */
export const moved = (value: string) =>
  value !== "" && value !== "none" && value !== "matrix(1, 0, 0, 1, 0, 0)";
