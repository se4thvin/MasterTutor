import type { FolderView } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/client.ts";
import { useHydrated } from "@/lib/hooks/use-hydrated.ts";

const NONE: FolderView[] = [];

/**
 * The workspace's folders, [] until they load. The server renders none (nothing is prefetched).
 * The sidebar tree and a page view hydrate in separate Suspense boundaries, so one may fill the
 * shared cache before the other hydrates: that one must still render none until it has hydrated,
 * or React throws #418 and client-renders the page (QA-017).
 */
export function useFolders(): FolderView[] {
  const { data } = useQuery(orpc.folders.tree.queryOptions({ input: {} }));
  const hydrated = useHydrated();
  return (hydrated ? data?.folders : undefined) ?? NONE;
}
