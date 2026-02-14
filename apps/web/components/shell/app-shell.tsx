"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Viewer } from "@/lib/server/viewer.ts";
import { KillBanner } from "./kill-banner.tsx";
import { Sidebar } from "./sidebar.tsx";

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const router = useRouter();
  const signOut = async () => {
    const { authClient } = await import("@/lib/auth-client.ts");
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar viewer={viewer} onSignOut={signOut} />
      <main id="main" className="main" tabIndex={-1}>
        <KillBanner />
        {children}
      </main>
    </div>
  );
}
