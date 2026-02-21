import type { Metadata } from "next";
import { VaultView } from "@/components/vault/vault-view.tsx";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return <VaultView />;
}
