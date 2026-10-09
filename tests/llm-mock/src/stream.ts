/** Deterministic Responses SSE for llm-mock, including encrypted reasoning and calls. */
export function streamFrames(response: Record<string, unknown> & { output: unknown[] }): string {
  const frames: string[] = [];
  let sequence = 0;
  const push = (type: string, data: Record<string, unknown>) =>
    frames.push(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
    );
  push("response.created", { response: { ...response, status: "in_progress", output: [] } });
  response.output.forEach((value, outputIndex) => {
    const item = value as Record<string, unknown>;
    if (item.type === "message") {
      const content = (item.content as Array<{ type: string; text?: string }>) ?? [];
      for (const [contentIndex, part] of content.entries()) {
        if (part.type !== "output_text" || !part.text) continue;
        for (let i = 0; i < part.text.length; i += 8)
          push("response.output_text.delta", {
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: part.text.slice(i, i + 8),
            logprobs: [],
          });
      }
    }
    push("response.output_item.done", { output_index: outputIndex, item });
  });
  push("response.completed", { response: { ...response, status: "completed" } });
  return frames.join("");
}
