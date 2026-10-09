import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx.ts";

/** The material's classes, for elements another library renders (Base UI popups). */
export const LIQUID_GLASS = "glass lglass";

type GlassTag = "div" | "aside" | "header" | "nav" | "section";

/**
 * Liquid Glass for the controls layer (HIG Materials, the "regular" variant): the one .glass blur
 * under a thicker tint, a specular rim and a soft sheen (components.css, .lglass). It is a static
 * material: no SVG filter on content and nothing that animates, so it costs one backdrop pass and
 * never repaints on its own. The tint keeps --label and --label-2 at AA over any backdrop
 * (tokens.test.ts); reduced transparency makes it solid, and without backdrop-filter it is opaque.
 * Use it for chrome that floats above content (sidebar, toolbars, floating controls), never for
 * content itself.
 */
export function LiquidGlass({
  as: Tag = "div",
  className,
  children,
  ...rest
}: { as?: GlassTag; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx(LIQUID_GLASS, className)} {...rest}>
      {children}
    </Tag>
  );
}
