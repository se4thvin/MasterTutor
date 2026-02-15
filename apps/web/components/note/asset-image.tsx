"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { orpc } from "@/lib/api/client.ts";

const FOUR_MINUTES = 4 * 60_000;

/** The only way an image reaches the page: a stored asset id resolved to a short-lived URL. */
export function AssetImage({
  assetId,
  alt,
  className,
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const { data, isError } = useQuery({
    ...orpc.assets.url.queryOptions({ input: { assetId } }),
    staleTime: FOUR_MINUTES,
  });
  if (isError) return <p className="t-foot">This image couldn't be loaded.</p>;
  if (!data) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading image">
        <Skeleton className="aspect-video w-full rounded-lg" />
      </div>
    );
  }
  // Presigned or data URLs are not optimisable by next/image, so a plain <img> is deliberate.
  return <img src={data.url} alt={alt} className={className} loading="lazy" decoding="async" />;
}
