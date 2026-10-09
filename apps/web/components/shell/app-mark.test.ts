import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { icons } from "@/components/ui/icons.ts";
import { GLYPH_NODES } from "./app-mark.tsx";

describe("app mark", () => {
  it("draws the same shapes as the sidebar brand glyph (icons.agentNote)", () => {
    const markup = renderToStaticMarkup(createElement(icons.agentNote));
    const shapes = [...markup.matchAll(/<(path|circle)([^>]*?)\/?>/g)].map(([, tag, attrs]) => [
      tag,
      Object.fromEntries([...attrs!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
    ]);
    expect(GLYPH_NODES).toEqual(shapes);
  });
});
