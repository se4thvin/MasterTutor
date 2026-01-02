import { z } from "zod";

/** Stored in runs.error; message must be safe to show (never page text or secrets). */
export const RunError = z.object({ code: z.string().min(1).max(64), message: z.string().max(500) });
export type RunError = z.infer<typeof RunError>;

export const ScrollPosition = z.object({ x: z.number(), y: z.number() });
export type ScrollPosition = z.infer<typeof ScrollPosition>;
