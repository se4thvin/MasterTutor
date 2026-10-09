/**
 * Built-CSS check: every rule that blurs a backdrop keeps the standard backdrop-filter, which
 * Chromium and Firefox read, beside Safari's -webkit- one. Next's minifier once merged a source pair
 * into the prefixed declaration alone, so glass blurred only in Safari (fixed on behaviour-isolation
 * in a418b94; the source now writes the property unprefixed and the build adds the prefix).
 */
export function backdropFilterFindings(css: string, file: string): string[] {
  const findings: string[] = [];
  for (const [, selector = "", body = ""] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prefixed = /-webkit-backdrop-filter\s*:/.test(body);
    const standard = /(?<!-webkit-)backdrop-filter\s*:/.test(body);
    if (prefixed && !standard)
      findings.push(
        `${file}: ${selector.trim()} has only -webkit-backdrop-filter (no blur in Chromium or Firefox)`,
      );
    if (standard && !prefixed)
      findings.push(
        `${file}: ${selector.trim()} has no -webkit-backdrop-filter (no blur in older Safari)`,
      );
  }
  return findings;
}
