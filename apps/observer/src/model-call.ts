import { COPILOT_LIMITS, MODELS, costUsd, type CopilotEvent } from "@mastertutor/contracts";
import type { ResponseOutputItem, StatelessOpenAI } from "@mastertutor/contracts/server/openai";
import { reserveCopilotSpend, settleCopilotSpend, type DbLike } from "@mastertutor/db";
import { recordObserverSpend, recordSpend } from "@mastertutor/telemetry/record";

type Params = Parameters<StatelessOpenAI["responses"]["stream"]>[0];
/** One billed stateless stream. Reservation survives cancellation without a usage report. */
export async function callModel(
  deps: { db: DbLike; openai: Pick<StatelessOpenAI, "responses">; dailyUsd: number },
  params: Params,
  emit: (event: CopilotEvent) => void,
  signal: AbortSignal,
): Promise<{ items: ResponseOutputItem[]; usd: number } | null> {
  signal.throwIfAborted();
  // UTF-8 request bytes upper-bound ordinary input tokens, without relying on the 4-char estimate.
  const inputBytes = Buffer.byteLength(
    JSON.stringify({ ...params, stream: true, store: false }),
    "utf8",
  );
  const maximumUsd =
    Math.ceil(
      costUsd(MODELS.observerCopilot, {
        input: inputBytes,
        cached: 0,
        output: COPILOT_LIMITS.maxOutputTokens,
        cacheWrite: 0,
      }) * 1e6,
    ) / 1e6;
  const reserved = await reserveCopilotSpend(deps.db, maximumUsd, deps.dailyUsd);
  if (!reserved) return null;
  const items: ResponseOutputItem[] = [];
  let usd = 0,
    charged = false;
  for await (const event of deps.openai.responses.stream(params, { signal })) {
    if (event.type === "text") {
      for (let i = 0; i < event.delta.length; i += COPILOT_LIMITS.textDeltaChars)
        emit({ type: "text", delta: event.delta.slice(i, i + COPILOT_LIMITS.textDeltaChars) });
    } else if (event.type === "item") items.push(event.item);
    else if (!charged) {
      usd = costUsd(event.model, { ...event.tokens, cacheWrite: 0 });
      await settleCopilotSpend(deps.db, reserved, usd);
      charged = true;
      recordSpend(usd, "copilot");
      recordObserverSpend("copilot", usd);
    }
  }
  if (!charged) throw new Error("missing_model_usage");
  return { items, usd };
}
