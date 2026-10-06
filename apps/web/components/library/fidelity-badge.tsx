import type { Fidelity } from "@mastertutor/contracts";
import { Badge } from "@/components/ui/badge.tsx";
import { FIDELITY_META } from "@/lib/notes/format.ts";

export function FidelityBadge({
  fidelity,
  coverage,
}: {
  fidelity: Fidelity;
  coverage: number | null;
}) {
  const meta = FIDELITY_META[fidelity];
  const percent =
    fidelity === "partial" && coverage !== null ? ` · ${Math.round(coverage * 100)}%` : "";
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
      {percent}
    </Badge>
  );
}
