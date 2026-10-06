import "katex/dist/katex.min.css";
import { replaceAssetUris } from "@mastertutor/contracts";
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

/** Exactly /api/assets/<uuid>: no traversal, query or other host can pass. */
const SAME_ORIGIN_ASSET =
  /^\/api\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const toAssetPath = (assetId: string) => `/api/assets/${assetId}`;

const components: Components = {
  // In-page anchors (footnotes) stay in the tab; everything else opens in a new one.
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a href={href}>{children}</a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  // A code block can scroll sideways, so keyboard users must be able to focus it.
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  // Only stored assets load, from this origin (cookie-authenticated, workspace-scoped). Any other
  // image in captured Markdown could track the reader, so it renders as text with no src.
  img: ({ src, alt }) =>
    typeof src === "string" && SAME_ORIGIN_ASSET.test(src) ? (
      <img src={src} alt={alt ?? ""} className="inline-asset" loading="lazy" decoding="async" />
    ) : (
      <span className="inline-img">{alt ? `Image: ${alt}` : "Image"}</span>
    ),
};

type Plugins = NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;
const SAFE: Plugins = [
  [rehypeSanitize, schema],
  [
    rehypeKatex,
    {
      throwOnError: false,
      strict: "ignore",
      trust: false,
      maxSize: 20,
      maxExpand: 200,
      output: "htmlAndMathml",
    },
  ],
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
      {replaceAssetUris(markdown, toAssetPath)}
    </ReactMarkdown>
  );
}
