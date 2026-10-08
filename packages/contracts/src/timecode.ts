const pad = (n: number) => String(n).padStart(2, "0");

/** spec §8: cite times as [mm:ss] ([h:mm:ss] past one hour). One rule for the agent, reader and export. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  return h > 0 ? `[${h}:${pad(m)}:${pad(s)}]` : `[${pad(m)}:${pad(s)}]`;
}
