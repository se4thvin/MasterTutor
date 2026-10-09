import type { DbLike } from "@mastertutor/db";

/** The single Compose service serializes turns; counts and spend remain durable in Postgres. */
const turns = new WeakMap<DbLike, Promise<void>>();
export async function serialTurn(
  db: DbLike,
  signal: AbortSignal,
  run: () => Promise<void>,
): Promise<void> {
  const previous = turns.get(db) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  turns.set(
    db,
    previous.then(() => current),
  );
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    signal.throwIfAborted();
    await Promise.race([previous, cancelled]);
    signal.throwIfAborted();
    await run();
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    release();
  }
}
