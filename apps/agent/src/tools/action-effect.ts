import { z } from "zod";

/**
 * What one executed computer action did, recorded per action (a batch can hide a click behind a
 * move): passive (move, scroll, wait, screenshot), input (reached the page), navigate (back,
 * forward, reload), address_bar (went to the emulated address bar), address_bar_landed (the ENTER
 * that opened exactly the URL typed there). The benchmark grader reads it.
 */
export const ACTION_EFFECTS = [
  "passive",
  "input",
  "navigate",
  "address_bar",
  "address_bar_landed",
] as const;
export const ActionEffect = z.enum(ACTION_EFFECTS);
export type ActionEffect = z.infer<typeof ActionEffect>;
