/** A leased browser slot; B1's Slot is assignable to this. */
export interface Slot {
  readonly name: string;
}

/** Spec §10.1. One implementation: NekoLiveView. */
export interface LiveView {
  /** n.eko: host → that user's member session (one "user" member per slot; userId is audited by the caller). */
  giveControl(slot: Slot, userId: string): Promise<void>;
  /** n.eko: host → agent admin session; the user member loses hosting rights. */
  takeControl(slot: Slot): Promise<void>;
  /** Toggles can_access_clipboard on the user member. */
  setClipboardAccess(slot: Slot, on: boolean): Promise<void>;
}
