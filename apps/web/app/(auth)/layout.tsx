import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getViewer } from "@/lib/server/viewer.ts";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getViewer()) redirect("/library");
  return (
    <main className="auth-page" id="main">
      <div className="auth-brand">
        <b>MasterTutor</b>
        <span className="muted">Faithful notes, by agent</span>
      </div>
      {children}
    </main>
  );
}
