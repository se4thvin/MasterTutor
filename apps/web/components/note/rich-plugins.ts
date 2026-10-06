import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { HIGHLIGHT_LANGUAGES } from "./highlight-languages.ts";
import type { RehypePlugins } from "./rich-plugins-loader.ts";

/**
 * The heavy half of note rendering (KaTeX, highlight.js), loaded only for blocks that need it.
 * Both run after rehype-sanitize; KaTeX never trusts commands and caps sizes and expansion.
 */
export const RICH_PLUGINS: RehypePlugins = [
  [
    rehypeKatex,
    {
      throwOnError: false,
      // Untrusted commands render as text in this colour; the token meets AA in light and dark.
      errorColor: "var(--danger)",
      strict: "ignore",
      trust: false,
      maxSize: 20,
      maxExpand: 200,
      output: "htmlAndMathml",
    },
  ],
  [rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES, detect: false }],
];
