const MARKER = /<(\/?)untrusted_page_content/gi;

/**
 * Page-derived text sent to the model is wrapped (spec §5.5). Enforcement never relies on this:
 * it only tells the model which text is data. Inner markers are escaped so content cannot
 * close the wrapper or open a fake one.
 */
export function wrapUntrusted(origin: string | null, content: string): string {
  const safeOrigin = (origin ?? "unknown").replace(/["<>&]/g, "");
  const safeContent = content.replace(MARKER, "&lt;$1untrusted_page_content");
  return `<untrusted_page_content origin="${safeOrigin}">\n${safeContent}\n</untrusted_page_content>`;
}
