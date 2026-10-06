"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { MotionProvider } from "@/components/motion/motion-provider.tsx";
import { ToastProvider } from "@/components/toast/toast-provider.tsx";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <ToastProvider>{children}</ToastProvider>
      </MotionProvider>
    </QueryClientProvider>
  );
}
