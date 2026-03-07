"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx.ts";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** Critical decision. Cancel leads and is focused; a destructive action is red and never the default. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="scrim" />
        <AlertDialog.Viewport className="alert-viewport">
          <AlertDialog.Popup className="alert" initialFocus={cancelRef}>
            <AlertDialog.Title className="t-title3">{title}</AlertDialog.Title>
            <AlertDialog.Description className="alert-desc">{description}</AlertDialog.Description>
            <div className="alert-actions">
              <AlertDialog.Close ref={cancelRef} className="btn btn-gray">
                {cancelLabel}
              </AlertDialog.Close>
              <button
                type="button"
                className={cx("btn", destructive ? "btn-danger" : "btn-primary")}
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
