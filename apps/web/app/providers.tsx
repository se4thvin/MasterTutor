"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";
import { ToastProvider } from "@/components/toast/toast-provider.tsx";
import { errorCode } from "@/lib/api/errors.ts";
import { signInPathFor } from "@/lib/auth/next-path.ts";

const isUnauthorized = (error: unknown) => errorCode(error) === "UNAUTHORIZED";

/**
 * One client per tab. When any query or mutation learns the session has ended, the cache (which
 * holds this user's data) is dropped and the tab returns to sign-in, remembering where it was.
 * A full navigation also discards every other piece of in-memory state.
 */
function createQueryClient(): QueryClient {
  let leaving = false;
  const onError = (error: unknown) => {
    if (!isUnauthorized(error) || leaving) return;
    leaving = true;
    client.clear();
    window.location.replace(signInPathFor(window.location.pathname, window.location.search));
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // An ended session will not come back by retrying.
        retry: (failures, error) => !isUnauthorized(error) && failures < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
    </QueryClientProvider>
  );
}
