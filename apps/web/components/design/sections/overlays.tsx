"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Menu, MenuItem, MenuPanel } from "@/components/ui/menu.tsx";
import { Popover, PopoverPanel } from "@/components/ui/popover.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";

export function OverlaysSection() {
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const [result, setResult] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => setSheet(true)}>Open sheet</Button>
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Move to…"
        description="Choose a folder for this note."
        footer={
          <Button variant="primary" onClick={() => setSheet(false)}>
            Done
          </Button>
        }
      >
        <p>Folders appear here.</p>
      </Sheet>
      <Button variant="danger" onClick={() => setAlert(true)}>
        Delete folder…
      </Button>
      <ConfirmDialog
        open={alert}
        onOpenChange={setAlert}
        title="Delete “Papers”?"
        description="Its subfolders are deleted too. Notes inside move to Unfiled."
        confirmLabel="Delete Folder"
        destructive
        onConfirm={() => setResult("Deleted")}
      />
      <Menu.Root>
        <Menu.Trigger render={<IconButton icon="more" label="More actions" />} />
        <MenuPanel>
          <MenuItem icon="edit" onSelect={() => setResult("Rename")}>
            Rename
          </MenuItem>
          <MenuItem icon="delete" destructive onSelect={() => setResult("Delete")}>
            Delete
          </MenuItem>
        </MenuPanel>
      </Menu.Root>
      <Popover.Root>
        <Popover.Trigger className="btn btn-gray">Show provenance</Popover.Trigger>
        <PopoverPanel label="Block provenance">
          <p className="t-callout">Exact DOM match · 46 words · 0 diffs.</p>
        </PopoverPanel>
      </Popover.Root>
      <span role="status" className="t-foot">
        {result}
      </span>
    </div>
  );
}
