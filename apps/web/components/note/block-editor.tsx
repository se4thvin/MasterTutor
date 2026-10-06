"use client";

import type { NoteBlock } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Extension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { patchNoteDetail } from "@/lib/notes/cache.ts";
import { editsAsRichText, richTextKit } from "@/lib/notes/rich-markdown.ts";

type Commit = (markdown: string, baseline: string) => void;

/** Saves optimistically; `baseline` is the editor's own first serialisation, so a no-op is never a write. */
function useCommitEdit(block: NoteBlock, onDone: () => void): Commit {
  const qc = useQueryClient();
  const toast = useToast();
  return (markdown, baseline) => {
    onDone();
    if (markdown === baseline) return;
    void (async () => {
      // A refetch in flight would land on top of the optimistic text.
      await qc.cancelQueries({
        queryKey: orpc.notes.get.queryKey({ input: { noteId: block.noteId } }),
      });
      const setBlock = (fn: (b: NoteBlock) => NoteBlock) =>
        patchNoteDetail(qc, block.noteId, (d) => ({
          ...d,
          blocks: d.blocks.map((b) => (b.id === block.id ? fn(b) : b)),
        }));
      setBlock((b) => ({
        ...b,
        markdown,
        edited: true,
        originalMarkdown: b.originalMarkdown ?? b.markdown,
      }));
      try {
        const updated = await api.notes.updateBlock({ blockId: block.id, markdown });
        setBlock(() => updated);
      } catch {
        // Restore only this block, so concurrent changes to the rest of the note survive.
        setBlock(() => block);
        toast({
          title: "Couldn't save your edit.",
          description: "The block is unchanged.",
          icon: "needsReview",
          tone: "danger",
        });
      }
    })();
  };
}

/**
 * ⌘↵ and Esc, ahead of StarterKit (HardBreak binds Mod-Enter at the default priority 100), so
 * saving never inserts a break first. Handlers are read at key time via the getters.
 */
const EditorKeys = Extension.create<{ save: () => void; cancel: () => void }>({
  name: "blockEditorKeys",
  priority: 1000,
  addOptions: () => ({ save: () => undefined, cancel: () => undefined }),
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        this.options.save();
        return true;
      },
      Escape: () => {
        this.options.cancel();
        return true;
      },
    };
  },
});

function Actions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="blk-editor-actions">
      <span className="t-foot">⌘↵ to save · Esc to cancel</span>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

function RichEditor({ block, commit, onCancel }: EditorProps) {
  const baseline = useRef<string | null>(null);
  const keys = useRef<{ save: () => void; cancel: () => void }>({
    save: () => undefined,
    cancel: onCancel,
  });
  const editor = useEditor({
    extensions: [
      richTextKit,
      Markdown,
      EditorKeys.configure({
        save: () => keys.current.save(),
        cancel: () => keys.current.cancel(),
      }),
    ],
    content: block.markdown,
    contentType: "markdown",
    immediatelyRender: false,
    autofocus: "end",
    onCreate: ({ editor: created }) => {
      baseline.current = created.getMarkdown();
    },
    editorProps: {
      attributes: {
        "aria-label": "Edit block",
        role: "textbox",
        "aria-multiline": "true",
        class: "tiptap-editable",
      },
    },
  });
  const save = () => {
    if (!editor) return;
    commit(editor.getMarkdown(), baseline.current ?? block.markdown);
  };
  useEffect(() => {
    keys.current = { save, cancel: onCancel };
  });
  return (
    <div className="blk-editor">
      <EditorContent editor={editor} />
      <Actions onCancel={onCancel} onSave={save} />
    </div>
  );
}

function RawEditor({ block, commit, onCancel }: EditorProps) {
  const [raw, setRaw] = useState(block.markdown);
  const save = () => commit(raw, block.markdown);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };
  return (
    <div className="blk-editor">
      <textarea
        className="blk-raw"
        aria-label="Edit block"
        value={raw}
        spellCheck={false}
        rows={Math.min(20, raw.split("\n").length + 1)}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <Actions onCancel={onCancel} onSave={save} />
    </div>
  );
}

interface EditorProps {
  block: NoteBlock;
  commit: Commit;
  onCancel: () => void;
}

/**
 * Rich editing only when the editor reproduces the block's Markdown byte for byte; otherwise (and
 * always for code, math, tables and transcripts) a raw textarea, so nothing is silently rewritten.
 */
export function BlockEditor({ block, onDone }: { block: NoteBlock; onDone: () => void }) {
  const commit = useCommitEdit(block, onDone);
  // Decided once per edit session, so a refetch mid-edit cannot swap the editor under the caret.
  const [rich] = useState(() => editsAsRichText(block));
  return rich ? (
    <RichEditor block={block} commit={commit} onCancel={onDone} />
  ) : (
    <RawEditor block={block} commit={commit} onCancel={onDone} />
  );
}
