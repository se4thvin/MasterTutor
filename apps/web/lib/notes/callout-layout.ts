export interface CalloutItem {
  id: string;
  anchorTop: number;
  height: number;
}
export interface PlacedCallout {
  id: string;
  top: number;
  hidden: boolean;
}

/**
 * Places margin captions in anchor order without overlap (D22). Forward pass pushes down;
 * when the last caption would overflow, the earlier ones slide up if they have room, and the
 * backward pass then restores the gaps. Captions that still cannot fit are hidden.
 */
export function layoutCallouts(
  items: readonly CalloutItem[],
  opts: { gap: number; containerHeight: number },
): PlacedCallout[] {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const shown: Array<CalloutItem & { top: number }> = [];
  const hidden: CalloutItem[] = [];
  let cursor = 0;
  for (const item of sorted) {
    const top = Math.max(item.anchorTop, cursor);
    if (top + item.height > opts.containerHeight) {
      // Make room by sliding every earlier caption up; the room is the space above the first one.
      const needed = top + item.height - opts.containerHeight;
      const room = shown[0]?.top ?? 0;
      if (shown.length > 0 && room >= needed) {
        for (const s of shown) s.top -= needed;
        shown.push({ ...item, top: top - needed });
        cursor = top - needed + item.height + opts.gap;
      } else {
        hidden.push(item);
      }
      continue;
    }
    shown.push({ ...item, top });
    cursor = top + item.height + opts.gap;
  }
  // Backward pass: keep the last caption inside the container, keeping gaps.
  for (let i = shown.length - 1; i >= 0; i--) {
    const s = shown[i];
    if (!s) continue;
    const next = shown[i + 1];
    const limit = next ? next.top - opts.gap - s.height : opts.containerHeight - s.height;
    s.top = Math.max(0, Math.min(s.top, limit));
  }
  const hiddenIds = new Set(hidden.map((h) => h.id));
  return sorted.map((item) => {
    const placed = shown.find((s) => s.id === item.id);
    return { id: item.id, top: placed?.top ?? item.anchorTop, hidden: hiddenIds.has(item.id) };
  });
}
