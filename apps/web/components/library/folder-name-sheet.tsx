"use client";

import { FolderName } from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { errorCopy } from "@/lib/api/errors.ts";

export type FolderNameTarget =
  | { mode: "create"; parentId: string | null; parentName: string | null }
  | { mode: "rename"; folderId: string; name: string };

interface Props {
  target: FolderNameTarget | null;
  onClose: () => void;
  onDone?: (folderId: string) => void;
}

export function FolderNameSheet({ target, onClose, onDone }: Props) {
  return target ? (
    <FolderNameForm
      key={target.mode === "rename" ? target.folderId : `new-${target.parentId}`}
      target={target}
      onClose={onClose}
      onDone={onDone}
    />
  ) : null;
}

function FolderNameForm({
  target,
  onClose,
  onDone,
}: {
  target: FolderNameTarget;
  onClose: () => void;
  onDone?: (folderId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(target.mode === "rename" ? target.name : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const creating = target.mode === "create";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = FolderName.safeParse(name);
    if (!parsed.success) {
      setError("Use 1–120 characters, without “/”.");
      return;
    }
    setPending(true);
    try {
      const folder =
        target.mode === "create"
          ? await api.folders.create({ name: parsed.data, parentId: target.parentId })
          : await api.folders.rename({ folderId: target.folderId, name: parsed.data });
      await qc.invalidateQueries({ queryKey: orpc.folders.key() });
      onDone?.(folder.id);
      onClose();
    } catch (err) {
      const copy = errorCopy(err);
      setError(
        copy === "That name is already taken."
          ? "A folder with that name already exists here."
          : copy,
      );
    } finally {
      setPending(false);
    }
  }

  const title = creating
    ? target.parentName
      ? `New folder in ${target.parentName}`
      : "New folder"
    : "Rename folder";
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="folder-name-form" disabled={pending}>
            {creating ? "Create" : "Rename"}
          </Button>
        </>
      }
    >
      <form id="folder-name-form" onSubmit={submit}>
        <TextField
          label="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          maxLength={120}
        />
      </form>
    </Sheet>
  );
}
