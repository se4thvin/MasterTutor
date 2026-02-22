"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";
import { ToastProvider } from "@/components/toast/toast-provider.tsx";
import { errorCode } from "@/lib/api/errors.ts";
import { onSessionEnd } from "@/lib/auth/session-end.ts";

const isUnauthorized = (error: unknown) => errorCode(error) === "UNAUTHORIZED";

/**
 * One client per tab. An ended session is handled at the RPC link (lib/api/client.ts), which
 * reaches every call; here the cache only subscribes, so this user's data is dropped then.
 */
function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // An ended session will not come back by retrying.
        retry: (failures, error) => !isUnauthorized(error) && failures < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  onSessionEnd(() => client.clear());
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
