import "katex/dist/katex.min.css";
import { replaceAssetUris } from "@mastertutor/contracts";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  needsRichRendering,
  rawHtmlPlugins,
  richPlugins,
  type RehypePlugins,
} from "./rich-plugins-loader.ts";

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
  // The sanitizer keeps <input> only for GFM task lists. Whatever a page sent, render nothing but
  // a disabled, labelled checkbox: never a text box (a fake form) and never unlabelled.
  input: ({ checked }) => (
    <input
      type="checkbox"
      disabled
      checked={Boolean(checked)}
      aria-label={checked ? "Done" : "To do"}
    />
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

const SANITIZE: RehypePlugins = [[rehypeSanitize, schema]];

interface Props {
  markdown: string;
  allowHtml?: boolean;
}

function Markdown({
  markdown,
  raw = [],
  rich = [],
}: {
  markdown: string;
  raw?: RehypePlugins;
  rich?: RehypePlugins;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[...raw, ...SANITIZE, ...rich]}
      components={components}
    >
      {replaceAssetUris(markdown, toAssetPath)}
    </ReactMarkdown>
  );
}

/**
 * Renders one block's Markdown. Page content is untrusted: sanitize runs before KaTeX and
 * highlight. The heavy parts load only for blocks that need them: KaTeX and highlight.js for math
 * or a fenced language (until then the block shows its sanitized plain rendering), and the HTML
 * parser for captured raw-HTML tables.
 */
export function BlockMarkdown({ markdown, allowHtml = false }: Props) {
  const raw = rawHtmlPlugins.usePlugins(allowHtml);
  const rich = richPlugins.usePlugins(needsRichRendering(markdown));
  // A raw-HTML table is not shown as Markdown source while its parser loads.
  if (allowHtml && !raw) return null;
  return <Markdown markdown={markdown} raw={raw} rich={rich} />;
}
