/** A response body larger than the caller allows; nothing past the cap is buffered. */
export class BodyTooLarge extends Error {
  constructor() {
    super("response body over its size cap");
    this.name = "BodyTooLarge";
  }
}

/** Reads a body as UTF-8 text, cancelling the stream once it passes `maxBytes`. */
export async function readCappedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
