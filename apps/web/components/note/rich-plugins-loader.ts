import { useEffect, useSyncExternalStore } from "react";
import type ReactMarkdown from "react-markdown";

export type RehypePlugins = NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>;

/** Math ($…$, $$…$$) or a fenced block with a language: the only things KaTeX or highlight.js touch. */
const MATH = /\$/;
const FENCED_LANGUAGE = /^ {0,3}(`{3,}|~{3,})[ \t]*[\w+#.-]/m;

export const needsRichRendering = (markdown: string) =>
  MATH.test(markdown) || FENCED_LANGUAGE.test(markdown);

/** A chunk of rehype plugins fetched once, on first need, shared by every block. */
function lazyPlugins(importer: () => Promise<RehypePlugins>) {
  let loaded: RehypePlugins | undefined;
  let loading: Promise<RehypePlugins> | undefined;
  const listeners = new Set<() => void>();
  const getLoaded = () => loaded;
  const subscribe = (notify: () => void) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  };
  const load = (): Promise<RehypePlugins> => {
    loading ??= importer().then((plugins) => {
      loaded = plugins;
      for (const notify of listeners) notify();
      return plugins;
    });
    return loading;
  };
  /**
   * The plugins once loaded, else undefined. The first paint is the sanitized plain block and
   * hydration never suspends. One getter serves both snapshots: nothing loads a chunk on the
   * server (effects never run there) and a fresh page hydrates before it arrives.
   */
  const usePlugins = (wanted: boolean): RehypePlugins | undefined => {
    useEffect(() => {
      if (wanted) void load();
    }, [wanted]);
    const plugins = useSyncExternalStore(subscribe, getLoaded, getLoaded);
    return wanted ? plugins : undefined;
  };
  return { load, usePlugins };
}

/** KaTeX and highlight.js. */
export const richPlugins = lazyPlugins(() =>
  import("./rich-plugins.ts").then((m) => m.RICH_PLUGINS),
);
/** rehype-raw (parse5), for captured raw-HTML tables only. */
export const rawHtmlPlugins = lazyPlugins(() =>
  import("rehype-raw").then((m): RehypePlugins => [m.default]),
);

/** Loads every lazy chunk; for tests that render synchronously. */
export const loadAllPlugins = () => Promise.all([richPlugins.load(), rawHtmlPlugins.load()]);
