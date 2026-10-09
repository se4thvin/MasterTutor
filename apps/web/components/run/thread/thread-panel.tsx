"use client";

import { Suspense, useId } from "react";
import { untrustedText } from "@mastertutor/contracts";
import { IconButton } from "@/components/ui/button.tsx";
import { ChunkBoundary } from "@/components/ui/chunk-boundary.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { LiquidGlass } from "@/components/ui/liquid-glass.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { lazyComponent } from "@/lib/hooks/lazy-component.ts";
import { peekLine } from "../model/thread-items.ts";
import type { ThreadProps } from "./thread-body.tsx";

/** The conversation and its message box are off the first load; the shells keep their place. */
const { Component: LazyThreadBody, usePrefetch: usePrefetchThreadBody } = lazyComponent(() =>
  import("./thread-body.tsx").then((mod) => mod.ThreadBody),
);
const ignoreFailure = () => undefined;

function Body(p: ThreadProps) {
  return (
    <ChunkBoundary what="the thread" onFailed={ignoreFailure}>
      <Suspense fallback={<div className="thread-loading" aria-busy="true" />}>
        <LazyThreadBody {...p} />
      </Suspense>
    </ChunkBoundary>
  );
}

/**
 * The thread as a pane beside the browser (or under it at tablet width); hideable. The pane is
 * Liquid Glass (controls layer); the conversation inside it sits on a solid surface (HIG: content
 * is never glass).
 */
export function ThreadPane({ id, onHide, ...p }: ThreadProps & { id: string; onHide(): void }) {
  const titleId = useId();
  usePrefetchThreadBody();
  return (
    <LiquidGlass
      as="aside"
      blur={false}
      id={id}
      className="thread"
      aria-labelledby={titleId}
      data-qa-obstacle
    >
      <div className="thread-head">
        <h2 id={titleId} className="thread-title">
          Thread
        </h2>
        <span className="thread-summary">{p.summary}</span>
        <IconButton
          icon="panelHide"
          label="Hide thread"
          aria-keyshortcuts="T"
          className="thread-hide"
          onClick={onHide}
        />
      </div>
      <Body {...p} />
    </LiquidGlass>
  );
}

/** Phone width: a peek bar under the browser opens the thread as a bottom sheet. */
export function ThreadSheet({
  open,
  onOpenChange,
  ...p
}: ThreadProps & { open: boolean; onOpenChange(open: boolean): void }) {
  usePrefetchThreadBody();
  const line = untrustedText(peekLine(p.items, p.thinking), 120);
  return (
    <>
      <LiquidGlass blur={false} className="thread-peek-glass">
        <button
          type="button"
          className="thread-peek"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Open thread: ${line}`}
          onClick={() => onOpenChange(true)}
        >
          <span className="thread-peek-glyph" aria-hidden="true">
            <Icon name="thread" size="sm" />
          </span>
          <span className="thread-peek-text">
            <bdi>{line}</bdi>
            <span className="thread-peek-summary">{p.summary}</span>
          </span>
          <Icon name="chevronRight" size="sm" />
        </button>
      </LiquidGlass>
      <Sheet open={open} onOpenChange={onOpenChange} title="Thread">
        <Body
          {...p}
          otp={null}
          onReview={() => {
            onOpenChange(false);
            p.onReview();
          }}
        />
      </Sheet>
    </>
  );
}
