import { NEKO_MEMBERS, TAKEOVER_GIVE_WAIT_MS } from "@mastertutor/contracts";
import type { LiveView, Slot } from "./live-view.ts";
import { NekoApiError, type NekoAdmin } from "./neko-admin.ts";

export class LiveViewError extends Error {
  readonly code: "user_not_connected";
  constructor(code: "user_not_connected") {
    super("The user's live view is not connected");
    this.name = "LiveViewError";
    this.code = code;
  }
}

export interface NekoLiveViewOptions {
  admin: NekoAdmin;
  /** How long giveControl waits for the user's n.eko websocket to be connected. */
  giveTimeoutMs?: number;
  retryDelayMs?: number;
}

interface NekoSession {
  id?: unknown;
  state?: { is_connected?: unknown };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The only LiveView (spec §10.1), over n.eko's admin REST API. The user member boots unhosted
 * (A1); giveControl grants can_host only once the user's live view is actually connected, so a
 * takeover with no live view fails instead of handing the browser to nobody.
 */
export function createNekoLiveView(options: NekoLiveViewOptions): LiveView {
  const { admin } = options;
  const user = NEKO_MEMBERS.user;
  const profile = (slot: Slot, patch: Record<string, boolean>) =>
    admin.request(slot.name, "POST", `/api/members/${user}`, patch);

  async function userConnected(slot: Slot): Promise<boolean> {
    const sessions = await admin.request(slot.name, "GET", "/api/sessions");
    return (
      Array.isArray(sessions) &&
      (sessions as NekoSession[]).some(
        (session) => session.id === user && session.state?.is_connected === true,
      )
    );
  }

  return {
    async giveControl(slot, _userId) {
      const deadline = Date.now() + (options.giveTimeoutMs ?? TAKEOVER_GIVE_WAIT_MS);
      while (!(await userConnected(slot))) {
        if (Date.now() >= deadline) throw new LiveViewError("user_not_connected");
        await sleep(options.retryDelayMs ?? 100);
      }
      await profile(slot, { can_host: true });
      try {
        await admin.request(slot.name, "POST", `/api/room/control/give/${user}`);
      } catch (error) {
        await profile(slot, { can_host: false }).catch(() => undefined);
        if (error instanceof NekoApiError && error.status === 404)
          throw new LiveViewError("user_not_connected");
        throw error;
      }
    },
    async takeControl(slot) {
      await admin.request(slot.name, "POST", "/api/room/control/take");
      await profile(slot, { can_host: false });
    },
    async setClipboardAccess(slot, on) {
      await profile(slot, { can_access_clipboard: on });
    },
  };
}
