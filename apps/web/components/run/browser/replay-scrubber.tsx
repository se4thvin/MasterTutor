"use client";

import { IconButton } from "@/components/ui/button.tsx";
import type { StepRow } from "../model/run-model.ts";

export const REPLAY_INTERVAL_MS = 1_000;

interface ReplayScrubberProps {
  steps: StepRow[];
  seq: number | null;
  playing: boolean;
  onSeq(seq: number): void;
  onTogglePlay(): void;
}

export function ReplayScrubber({ steps, seq, playing, onSeq, onTogglePlay }: ReplayScrubberProps) {
  const index = Math.max(
    0,
    steps.findIndex((s) => s.seq === seq),
  );
  const ratio = steps.length > 1 ? index / (steps.length - 1) : 0;
  return (
    <div className="run-scrub glass">
      <IconButton
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause replay" : "Play replay"}
        onClick={onTogglePlay}
      />
      <div className="run-scrub-track">
        <div className="run-scrub-rail" />
        <div className="run-scrub-fill" style={{ transform: `scaleX(${ratio})` }} />
        <input
          type="range"
          min={1}
          max={steps.length}
          value={index + 1}
          aria-label="Replay position"
          aria-valuetext={`Step ${index + 1} of ${steps.length}`}
          onChange={(e) => {
            const step = steps[Number(e.target.value) - 1];
            if (step) onSeq(step.seq);
          }}
        />
      </div>
      <span className="run-scrub-label">
        {index + 1} / {steps.length}
      </span>
    </div>
  );
}
