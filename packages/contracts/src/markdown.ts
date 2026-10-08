/** One source of truth for the block size limit (NoteBlock, the writer and the block splitter). */
export const MAX_BLOCK_CHARS = 200_000;

/** Every character a backslash escapes in the Markdown we store: escapeMarkdownText's set and the rest of CommonMark's. */
const ESCAPED = /\\([\\`*_{}[\]()#+\-.!|$<>~])/g;

/** Escapes text so Markdown renders it literally. */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`)
    .replace(/^(\s{0,3})([#>+-]|\d{1,9}[.)])(?=\s)/gm, (_m, space: string, mark: string) =>
      /\d/.test(mark) ? `${space}${mark.slice(0, -1)}\\${mark.slice(-1)}` : `${space}\\${mark}`,
    );
}

/** Removes backslash escapes: what the reader sees (the writer's secret screen and the verifier use it). */
export function unescapeMarkdown(markdown: string): string {
  return markdown.replace(ESCAPED, "$1");
}
