import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell.tsx";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
