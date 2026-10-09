import { SERVICE_WORKER_SOURCE } from "@/lib/push/service-worker.ts";

export const dynamic = "force-static";

/** Served from the root so its scope is the whole app; revalidated on every load, never stale. */
export function GET(): Response {
  return new Response(SERVICE_WORKER_SOURCE, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
