import { Uuid } from "@mastertutor/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunView } from "@/components/run/run-view.tsx";
import { getViewer } from "@/lib/server/viewer.ts";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!Uuid.safeParse(runId).success) notFound();
  // The layout already redirected a signed-out visitor; the id names "You" in decisions (A4).
  const viewer = await getViewer();
  // Keyed by run: another run starts from its own snapshot and stream position (M6).
  return <RunView key={runId} runId={runId} viewerId={viewer?.id ?? null} />;
}
