import { cx } from "@/lib/cx.ts";

/** Shimmer placeholder (transform-only). Wrap loading regions in aria-busy="true". */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("sk", className)} aria-hidden="true" />;
}
