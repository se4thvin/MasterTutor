import type { NoteBlock } from "@mastertutor/contracts";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/** These stay byte-faithful, so they always edit as raw text. */
export const RAW_BLOCK_TYPES: ReadonlySet<NoteBlock["type"]> = new Set([
  "code",
  "math",
  "table",
  "transcript",
]);

/**
 * The rich editor's document model. Underline is off: its `++x++` is not GFM and the reader would
 * show the pluses. Links never open or auto-link while editing.
 */
export const richTextKit = StarterKit.configure({
  link: { openOnClick: false, autolink: false },
  underline: false,
});

let manager: MarkdownManager | undefined;
let schema: ReturnType<typeof getSchema> | undefined;

/**
 * True when Markdown → editor document → Markdown returns the input unchanged. Anything the editor
 * cannot represent (inline math, footnotes, task lists, inline HTML, `_em_`, `*` bullets…) fails,
 * so the block edits as raw text instead of being silently rewritten.
 */
export function roundTripsRichText(markdown: string): boolean {
  manager ??= new MarkdownManager({ extensions: [richTextKit] });
  schema ??= getSchema([richTextKit]);
  try {
    const doc = schema.nodeFromJSON(manager.parse(markdown));
    doc.check();
    return manager.serialize(doc.toJSON()) === markdown;
  } catch {
    return false;
  }
}

export const editsAsRichText = (block: Pick<NoteBlock, "type" | "markdown">): boolean =>
  !RAW_BLOCK_TYPES.has(block.type) && roundTripsRichText(block.markdown);
