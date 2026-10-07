/** Chromium's Keyboard Lock API; absent elsewhere (spec §10.3 Keyboard). */
interface KeyboardLock {
  lock?: (keyCodes?: string[]) => Promise<void>;
  unlock?: () => void;
}
interface FullscreenTarget {
  requestFullscreen(options?: FullscreenOptions): Promise<void>;
}
interface FullscreenDocument {
  fullscreenElement: Element | null;
  exitFullscreen(): Promise<void>;
}

export async function enterFullscreen(
  el: FullscreenTarget,
  keyboard: KeyboardLock | undefined,
): Promise<boolean> {
  try {
    await el.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return false;
  }
  try {
    await keyboard?.lock?.();
  } catch {
    // Best effort: without the lock, the host browser keeps ⌘T/⌘W/⌘N.
  }
  return true;
}

export function exitFullscreen(doc: FullscreenDocument, keyboard: KeyboardLock | undefined): void {
  keyboard?.unlock?.();
  if (doc.fullscreenElement) void doc.exitFullscreen();
}

export function keyboardOf(nav: Navigator): KeyboardLock | undefined {
  return (nav as Navigator & { keyboard?: KeyboardLock }).keyboard;
}
