"use client";

import type { NoteBlock, NoteDetail } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useState, type KeyboardEvent } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail } from "@/lib/notes/cache.ts";

/** These stay byte-faithful, so they edit as raw text rather than through a rich-text round trip. */
const RAW_TYPES = new Set(["code", "math", "table", "transcript"]);

export function BlockEditor({ block, onDone }: { block: NoteBlock; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [raw, setRaw] = useState(block.markdown);
  const rich = !RAW_TYPES.has(block.type);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false } }), Markdown],
    content: block.markdown,
    contentType: "markdown",
    immediatelyRender: false,
    autofocus: "end",
    editable: rich,
    editorProps: {
      attributes: {
        "aria-label": "Edit block",
        role: "textbox",
        "aria-multiline": "true",
        class: "tiptap-editable",
      },
    },
  });

  const save = async () => {
    const markdown = rich ? (editor?.getMarkdown() ?? block.markdown) : raw;
    onDone();
    if (markdown === block.markdown) return;
    const previous = patchNoteDetail(qc, block.noteId, (d: NoteDetail) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.id === block.id
          ? { ...b, markdown, edited: true, originalMarkdown: b.originalMarkdown ?? b.markdown }
          : b,
      ),
    }));
    try {
      const updated = await api.notes.updateBlock({ blockId: block.id, markdown });
      patchNoteDetail(qc, block.noteId, (d) => ({
        ...d,
        blocks: d.blocks.map((b) => (b.id === updated.id ? updated : b)),
      }));
    } catch {
      if (previous) {
        qc.setQueryData(orpc.notes.get.queryKey({ input: { noteId: block.noteId } }), previous);
      }
      toast({
        title: "Couldn't save your edit.",
        description: "The block is unchanged.",
        icon: "needsReview",
        tone: "danger",
      });
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    // The wrapper only relays key events from the editor or textarea inside it.
    <div className="blk-editor" onKeyDown={onKeyDown}>
      {rich ? (
        <EditorContent editor={editor} />
      ) : (
        <textarea
          className="blk-raw"
          aria-label="Edit block"
          value={raw}
          spellCheck={false}
          rows={Math.min(20, raw.split("\n").length + 1)}
          onChange={(e) => setRaw(e.target.value)}
          autoFocus
        />
      )}
      <div className="blk-editor-actions">
        <span className="t-foot">⌘↵ to save · Esc to cancel</span>
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
