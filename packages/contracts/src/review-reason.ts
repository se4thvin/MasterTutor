import type { BlockOrigin } from "./enums.ts";

/** Why an unverified block needs a look, by where its text came from (one source: reader and export). */
export const REVIEW_REASON: Record<BlockOrigin, string> = {
  ocr_model: "Read from an image by the model.",
  asr: "Transcribed from the audio by the model.",
  dom: "Not yet matched to the page text.",
  pdf: "Not yet matched to the PDF's text.",
  captions: "From the uploader's captions, not yet checked against the audio.",
  model: "Written by the agent.",
  user: "Written by you and not yet checked.",
};
