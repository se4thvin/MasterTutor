import type { Metadata } from "next";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "New task" };

export default function NewTaskPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "New task" }]} />
      </Toolbar>
      <div className="wrap">
        <PageHead
          title="Take notes on"
          lede="Describe a source and the agent opens its own browser to capture it."
        />
      </div>
    </>
  );
}
