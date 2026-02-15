"use client";

import type { SourceKind } from "@mastertutor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { orpc } from "@/lib/api/client.ts";

const DEBOUNCE_MS = 150;

/** Debounced block search. `settledQuery` is the text the returned hits were searched for. */
export function useNoteSearch(q: string, kind: SourceKind | null) {
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const query = useQuery({
    ...orpc.notes.search.queryOptions({ input: { q: debounced || " ", kind, limit: 20 } }),
    enabled: debounced.length > 0,
  });
  return {
    hits: debounced ? (query.data?.items ?? []) : [],
    isFetching: query.isFetching,
    settledQuery: debounced,
  };
}
