"use client";

import { useId, useState } from "react";
import { CodeSlots } from "@/components/bits/code-slots.tsx";
import { api } from "@/lib/api/client.ts";

type Phase = "entering" | "sending" | "sent" | "failed";
const PHASE_TEXT: Record<Phase, string> = {
  entering: "Goes straight to the browser. Never to the model.",
  sending: "Sending to the browser…",
  sent: "Sent to the browser. The agent only saw “code entered”.",
  failed: "Couldn't send the code. Enter it again.",
};

/** The code exists only in CodeSlots' state and this closure until web seals it (spec §9). */
export function OtpCard({ runId, host }: { runId: string; host: string }) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>("entering");
  const [sealed, setSealed] = useState<number | null>(null);
  // A failed submit remounts CodeSlots, so the retry starts with empty boxes.
  const [attempt, setAttempt] = useState(0);
  const submit = (code: string) => {
    setSealed(code.length);
    setPhase("sending");
    api.runs.submitOtp({ runId, code }).then(
      () => setPhase("sent"),
      () => {
        setSealed(null);
        setPhase("failed");
        setAttempt((n) => n + 1);
      },
    );
  };
  return (
    <section className="run-otp" aria-labelledby={`${id}-title`} data-testid="otp-card">
      <h3 id={`${id}-title`} className="run-otp-title">
        Enter the code sent to you
      </h3>
      <p className="run-otp-foot">
        <bdi>{host}</bdi> asked for a one-time code.
      </p>
      <CodeSlots key={attempt} label="One-time code" sealed={sealed} onComplete={submit} />
      <p className="run-otp-state" data-phase={phase} role="status">
        {PHASE_TEXT[phase]}
      </p>
      <p className="run-otp-flow">
        <span className="sr-only">
          Where the code goes: you, then the browser, never the model.
        </span>
        <span aria-hidden="true">
          You → Browser · <s>model</s>
        </span>
      </p>
    </section>
  );
}
