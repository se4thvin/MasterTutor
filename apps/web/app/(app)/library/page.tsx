import type { Metadata } from "next";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Toolbar, Crumbs } from "@/components/ui/toolbar.tsx";

export const metadata: Metadata = { title: "Library" };

/** Placeholder so the shell has a landing page; F2 replaces this file with the real library. */
export default function LibraryPage() {
  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Library" }]} />
      </Toolbar>
      <div className="wrap">
        <PageHead title="Library" lede="Every note the agent has taken." />
      </div>
    </>
  );
}
