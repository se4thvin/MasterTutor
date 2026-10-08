/** Page functions are sent as source text, so they must compile on their own (no imports, no outer names). */
export function assertSelfContained(fn: (...args: never[]) => unknown): void {
  const source = fn.toString();
  if (/\b(import\s*\(|import\.meta|require\s*\(|__vite|__name\()/.test(source)) {
    throw new Error(`page function ${fn.name} is not self-contained`);
  }
  new Function(`return (${source});`);
}
