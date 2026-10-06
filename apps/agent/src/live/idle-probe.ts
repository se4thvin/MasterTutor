import { SLOT_IDLE_PORT } from "@mastertutor/contracts";

export interface SlotIdleProbe {
  /** Milliseconds since the last X (n.eko/XTest) input in the slot; CDP input does not count. */
  userIdleMs(slotName: string): Promise<number>;
}

export function createSlotIdleProbe(
  options: { url?: (slotName: string) => string; fetch?: typeof fetch; timeoutMs?: number } = {},
): SlotIdleProbe {
  const url = options.url ?? ((slot: string) => `http://${slot}:${SLOT_IDLE_PORT}/`);
  return {
    async userIdleMs(slotName) {
      const response = await (options.fetch ?? fetch)(url(slotName), {
        signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
      });
      const text = (await response.text()).trim();
      if (!response.ok || !/^[0-9]{1,12}$/.test(text))
        throw new Error(`slot ${slotName} idle probe gave no value`);
      return Number(text);
    },
  };
}
