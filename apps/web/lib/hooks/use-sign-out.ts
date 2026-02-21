"use client";

import { useRouter } from "next/navigation";

/** Ends the session and returns to sign-in. The auth client loads only when it is needed. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    const { authClient } = await import("@/lib/auth-client.ts");
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
}
