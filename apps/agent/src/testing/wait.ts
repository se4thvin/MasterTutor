/** Polls until probe returns a truthy value; throws with the label after the timeout. */
export async function waitFor<T>(
  probe: () => T | Promise<T>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline)
      throw new Error(`waitFor timed out: ${options.label ?? "condition"}`);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 25));
  }
}
