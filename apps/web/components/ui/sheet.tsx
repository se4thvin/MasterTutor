"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode, RefObject } from "react";
import { cx } from "@/lib/cx.ts";
import { Icon } from "./icon.tsx";
import { LIQUID_GLASS } from "./liquid-glass.tsx";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}

/** Focused task: bottom sheet on compact widths, centred glass panel on regular widths (HIG). */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  initialFocus,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="sheet-viewport">
          <Dialog.Popup className={cx("sheet", LIQUID_GLASS)} initialFocus={initialFocus}>
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <Dialog.Title className="t-title2">{title}</Dialog.Title>
              <Dialog.Close className="icon-btn" aria-label="Close">
                <Icon name="close" />
              </Dialog.Close>
            </div>
            {description ? (
              <Dialog.Description className="sheet-desc">{description}</Dialog.Description>
            ) : null}
            <div className="sheet-body">{children}</div>
            {footer ? <div className="sheet-foot">{footer}</div> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
