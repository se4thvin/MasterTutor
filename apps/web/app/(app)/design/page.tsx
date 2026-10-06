import type { Metadata } from "next";
import { DesignSystemView } from "@/components/design/design-system-view.tsx";

export const metadata: Metadata = { title: "Design system" };

export default function DesignPage() {
  return <DesignSystemView />;
}
