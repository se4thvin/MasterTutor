import type { BBox } from "@mastertutor/contracts";

export interface DoclingBlock {
  type: "heading" | "paragraph" | "list" | "code" | "table" | "math" | "figure";
  markdown: string;
  page: number;
  bbox: BBox;
  /** Picture/formula region to crop from the page render instead of text. */
  crop: boolean;
}
export interface DoclingClient {
  convert(bytes: Uint8Array, filename: string, signal: AbortSignal): Promise<DoclingBlock[]>;
}
