import { z } from "zod";

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

const Json3 = z.object({
  events: z.array(
    z.object({
      tStartMs: z.number().nonnegative().default(0),
      dDurationMs: z.number().nonnegative().default(0),
      segs: z.array(z.object({ utf8: z.string().default("") })).optional(),
    }),
  ),
});

/** YouTube `fmt=json3` caption tracks (spec §8). Null when the body is not JSON3. */
export function parseJson3(body: string): CaptionSegment[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = Json3.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.events.flatMap((event) => {
    const text = (event.segs ?? [])
      .map((s) => s.utf8)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return [];
    return [
      {
        start: event.tStartMs / 1_000,
        end: (event.tStartMs + event.dDurationMs) / 1_000,
        text,
      },
    ];
  });
}
