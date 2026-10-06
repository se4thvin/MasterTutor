"use client";

import type { NoteBlock } from "@mastertutor/contracts";
import { BlockContent } from "./block-view.tsx";

/** Task 22 replaces this with the Tiptap editor; until then editing shows the block as read. */
export function BlockEditor({ block }: { block: NoteBlock; onDone: () => void }) {
  return <BlockContent block={block} />;
}
