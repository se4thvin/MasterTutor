import type { Metadata } from "next";
import { NewTaskForm } from "@/components/new-task/new-task-form.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "New task" };

export default function NewTaskPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "New task" }]} />
      </Toolbar>
      <NewTaskForm />
    </>
  );
}
