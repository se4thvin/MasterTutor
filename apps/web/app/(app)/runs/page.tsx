import type { Metadata } from "next";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Runs" }]} />
      </Toolbar>
      <div className="wrap">
        <PageHead title="Runs" lede="Every task the agent has worked on." />
      </div>
    </>
  );
}
