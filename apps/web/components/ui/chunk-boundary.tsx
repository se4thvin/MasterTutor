"use client";

import { Component, type ReactNode } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";

class CatchFailedChunk extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Wraps a lazily loaded surface (lib/hooks/lazy-component.ts). If its chunk fails to arrive
 * (offline, or a deploy replaced it), the surface renders nothing, a toast says so and offers a
 * reload, and `onFailed` lets the owner close it; the error never reaches Next's root error page.
 * A reload is the retry: the bundler's runtime keeps a failed chunk load for the page's lifetime.
 */
export function ChunkBoundary({
  what,
  onFailed,
  children,
}: {
  /** The surface, as the toast names it: "Couldn't open {what}." */
  what: string;
  onFailed: () => void;
  children: ReactNode;
}) {
  const toast = useToast();
  return (
    <CatchFailedChunk
      onError={() => {
        toast({
          title: `Couldn't open ${what}.`,
          description: "Check your connection, then reload the page.",
          icon: "needsReview",
          tone: "danger",
          actionLabel: "Reload",
          onAction: () => window.location.reload(),
        });
        onFailed();
      }}
    >
      {children}
    </CatchFailedChunk>
  );
}
