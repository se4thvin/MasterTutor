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
  blur = true,
  className,
  children,
  ...rest
}: {
  as?: GlassTag;
  /** false where nothing ever passes beneath (a docked sidebar): the look, without a blur pass. */
  blur?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx(LIQUID_GLASS, !blur && "lglass-still", className)} {...rest}>
      {children}
    </Tag>
  );
}
