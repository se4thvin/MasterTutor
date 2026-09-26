import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewTaskForm } from "@/components/new-task/new-task-form.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";
import { getViewer } from "@/lib/server/viewer.ts";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage() {
  // The (app) layout already resolved the viewer; getViewer is per-request cached.
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "New task" }]} />
      </Toolbar>
      {/* The draft is kept per viewer, so another account in this browser never sees it. */}
      <NewTaskForm viewerId={viewer.id} />
    </>
  );
}
