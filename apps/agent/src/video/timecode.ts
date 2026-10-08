/** Description chapter timestamps (`m:ss`, `h:mm:ss`). Formatting lives in contracts (formatTimecode). */
export function parseTimecode(text: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
}
