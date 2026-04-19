"use client";

import { Component, type ReactNode } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";

/** Turbopack names a chunk that failed to arrive "ChunkLoadError". */
const isChunkLoadError = (error: unknown) =>
  error instanceof Error && error.name === "ChunkLoadError";

/** Catches only a failed chunk; any other error is rethrown to the next boundary (Next's). */
class CatchFailedChunk extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean; error: unknown }
> {
  override state: { failed: boolean; error: unknown } = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown) {
    return isChunkLoadError(error) ? { failed: true, error: null } : { failed: false, error };
  }

  override componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) this.props.onError();
  }

  override render() {
    if (this.state.error) throw this.state.error;
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Wraps a lazily loaded surface (lib/hooks/lazy-component.ts). If its chunk fails to arrive
 * (offline, or a deploy replaced it), the surface renders nothing, a toast says so and offers a
 * reload, and `onFailed` lets the owner close it; that failure never reaches Next's error page.
 * A reload is the only retry: React.lazy and Turbopack both keep a failed load for the page's
 * lifetime. Any other error (a bug) is not caught here: it goes on to Next's error handling.
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
