"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast/toast-provider.tsx";

/**
 * Ends the session and returns to sign-in. The auth client loads only when it is needed. On
 * success the query cache is cleared, so nothing from this session (notes, vault list, settings)
 * survives into the next sign-in in the same tab. A failure keeps the user here and says so.
 */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return async () => {
    try {
      const { authClient } = await import("@/lib/auth-client.ts");
      const { error } = await authClient.signOut();
      if (error) throw new Error("sign-out failed");
    } catch {
      toast({ title: "Couldn't sign out. Try again.", icon: "needsReview", tone: "danger" });
      return;
    }
    qc.clear();
    router.replace("/sign-in");
    router.refresh();
  };
}
