"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Suspense } from "react";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";

// The body (search, results, LayoutMotion) is fetched when the browser is idle, not on first load.
const { Component: PaletteBody, usePrefetch: usePrefetchPaletteBody } = lazyComponent(() =>
  import("./palette-body.tsx").then((mod) => mod.PaletteBody),
);

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  usePrefetchPaletteBody();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" />
        <Dialog.Viewport className="palette-viewport">
          <Dialog.Popup className="palette glass">
            {open ? (
              <ChunkBoundary what="search" onFailed={() => onOpenChange(false)}>
                <Suspense fallback={null}>
                  <PaletteBody onDone={() => onOpenChange(false)} />
                </Suspense>
              </ChunkBoundary>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
