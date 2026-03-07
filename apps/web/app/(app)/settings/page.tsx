import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view.tsx";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsView />;
}
