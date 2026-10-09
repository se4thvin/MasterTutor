import { ImageResponse } from "next/og";
import { APP_MARK_COLORS } from "@/lib/app-mark-colors.ts";

/**
 * Lucide's sparkles, the sidebar brand mark's glyph (icons.agentNote). ImageResponse draws plain
 * SVG, not client icon components, so its shapes are spelled here; app-mark.test.ts keeps them
 * equal to lucide's.
 */
export const GLYPH_NODES = [
  [
    "path",
    {
      d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
    },
  ],
  ["path", { d: "M20 2v4" }],
  ["path", { d: "M22 4h-4" }],
  ["circle", { cx: "4", cy: "20", r: "2" }],
] as const;

/** The sidebar's brand mark (the agent-note glyph on a label-coloured tile) as a square PNG. */
export function appMarkImage(size: number): ImageResponse {
  const side = Math.round(size * 0.5);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: APP_MARK_COLORS.tile,
      }}
    >
      <svg
        width={side}
        height={side}
        viewBox="0 0 24 24"
        fill="none"
        stroke={APP_MARK_COLORS.glyph}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPH_NODES.map(([Tag, attributes], i) => (
          <Tag key={i} {...attributes} />
        ))}
      </svg>
    </div>,
    { width: size, height: size },
  );
}
