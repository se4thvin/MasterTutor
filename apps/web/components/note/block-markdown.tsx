import "katex/dist/katex.min.css";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { HIGHLIGHT_LANGUAGES } from "./highlight-languages.ts";

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Captured images are asset blocks, loaded only through assets.url; an inline <img> in page
  // markdown could track the reader, so it renders as text and never carries a src.
  img: ({ alt }) => <span className="inline-img">{alt ? `Image: ${alt}` : "Image"}</span>,
};

type Plugins = NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;
const SAFE: Plugins = [
  [rehypeSanitize, schema],
  [rehypeKatex, { throwOnError: false, strict: "ignore", trust: false, output: "htmlAndMathml" }],
  [rehypeHighlight, { languages: HIGHLIGHT_LANGUAGES, detect: false }],
];
const WITH_HTML: Plugins = [rehypeRaw, ...SAFE];

/** Renders one block's Markdown. Page content is untrusted: sanitize runs before KaTeX and highlight. */
export function BlockMarkdown({
  markdown,
  allowHtml = false,
}: {
  markdown: string;
  allowHtml?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={allowHtml ? WITH_HTML : SAFE}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}
