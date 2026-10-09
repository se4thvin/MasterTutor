"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { CodeSlots } from "@/components/bits/code-slots.tsx";
import { useToast } from "@/components/toast/toast-provider.tsx";
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
  // The run often resumes (and this card leaves) before or in the same render as submitOtp's
  // answer: the confirmation then goes to a toast, so the person still sees where the code went
  // (review M3). Decided where the card leaves, not a frame later: the run's events are applied in
  // a requestAnimationFrame flush, so a resume batched with the answer could unmount the card after
  // such a check, and "sent" was then never shown anywhere.
  const toast = useToast();
  const mounted = useRef(true);
  const accepted = useRef(false); // submitOtp answered
  const shown = useRef(false); // "sent" reached the screen on this card
  const confirmElsewhere = () => toast({ title: PHASE_TEXT.sent, icon: "codeOtp" });
  useLayoutEffect(() => {
    if (phase === "sent") shown.current = true;
  }, [phase]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (accepted.current && !shown.current) confirmElsewhere();
    };
    // Mount and unmount only: the toast function is the provider's, stable for the card's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submit = (code: string) => {
    setSealed(code.length);
    setPhase("sending");
    api.runs.submitOtp({ runId, code }).then(
      () => {
        accepted.current = true;
        if (mounted.current) setPhase("sent");
        else confirmElsewhere();
      },
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
