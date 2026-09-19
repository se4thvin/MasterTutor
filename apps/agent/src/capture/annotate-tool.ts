import { AnnotateArgs, AnnotateResult } from "@mastertutor/contracts";
import type { LibraryServices } from "../library.ts";
import { writeContext } from "../notes/note-writer.ts";
import { type Tool, ToolError } from "../tools/types.ts";
import { asToolErrors } from "./capture-tool.ts";

/** spec §6 `annotate`: model text, shown as distinct; never edits captured blocks. Results carry ids only. */
export function createAnnotateTool(services: LibraryServices): Tool<AnnotateArgs, AnnotateResult> {
  return {
    name: "annotate",
    args: AnnotateArgs,
    result: AnnotateResult,
    untrusted: false,
    run: (ctx, args) =>
      asToolErrors(async () => {
        const w = writeContext(ctx);
        const text = args.markdown.trim();
        const markdown = args.kind === "heading" && !text.startsWith("#") ? `## ${text}` : text;
        await services.writer.assertRunNote(w.scope, args.noteId);
        const [blockId] = await services.writer.appendBlocks(w, {
          noteId: args.noteId,
          sourceId: null,
          afterBlockId: args.afterBlockId,
          blocks: [
            {
              type: args.kind === "heading" ? "heading" : "commentary",
              markdown,
              origin: "model",
              assetId: null,
              anchor: null,
              verified: false,
            },
          ],
        });
        if (!blockId) throw new ToolError("annotate_failed", "The annotation was not stored");
        return { blockId };
      }),
  };
}
