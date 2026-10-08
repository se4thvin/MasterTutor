/** A response body larger than the caller allows; nothing past the cap is buffered. */
export class BodyTooLarge extends Error {
  constructor() {
    super("response body over its size cap");
    this.name = "BodyTooLarge";
  }
}

/** Reads a body's bytes, cancelling the stream once it passes `maxBytes`. */
export async function readCappedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
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
  return new Uint8Array(Buffer.concat(chunks));
}

/** Reads a body as UTF-8 text, cancelling the stream once it passes `maxBytes`. */
export async function readCappedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  return Buffer.from(await readCappedBytes(body, maxBytes)).toString("utf8");
}
