import type { Metadata } from "next";
import { AuditView } from "@/components/settings/audit-view.tsx";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AuditView />;
}
