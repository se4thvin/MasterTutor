"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";

export function ToastsSection() {
  const toast = useToast();
  const [result, setResult] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => toast({ title: "Moved to Papers", icon: "move", actionLabel: "Undo", onAction: () => setResult("Undo pressed") })}>
        Show undo toast
      </Button>
      <Button onClick={() => toast({ title: "Couldn't move the note.", description: "Nothing changed.", icon: "needsReview", tone: "danger" })}>
        Show error toast
      </Button>
      <span className="t-foot" aria-live="polite">{result}</span>
    </div>
  );
}
