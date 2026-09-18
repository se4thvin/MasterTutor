import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemView } from "@/components/design/design-system-view.tsx";

export const metadata: Metadata = { title: "Design system" };

/** A development and UI-test page: production builds (no WEB_FIXTURE_API at build time) answer 404 (D48). */
export default function DesignPage() {
  if (!__FIXTURE_BUILD__) notFound();
  return <DesignSystemView />;
}
