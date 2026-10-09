"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import PipLazy from "@/components/mascot/pip-lazy.tsx";
import {
  PIP_ACCESSORIES,
  PIP_STATES,
  type PipAccessory,
  type PipSize,
  type PipState,
} from "@/components/mascot/pip-types.ts";

const CAPTIONS: Record<PipState, string> = {
  idle: "Breathes, blinks and sways",
  attentive: "Looks toward the cursor or a target",
  thinking: "Hand to cheek, thought bubbles",
  working: "Types on a tiny clay laptop",
  waiting: "Looks at you and bounces: a person is needed",
  waving: "Hello and goodbye",
  celebrating: "Hop, party hat, confetti",
  dozing: "Eyes closed, zzz, the sprout droops",
  oops: "A small wobble and a sheepish face",
  reading: "Holds a book and reads line by line",
};

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ");

/** One Pip and a state switcher: watch blends, and the perf and motion entries' target. */
function SinglePip({ initial, size }: { initial: PipState; size: PipSize }) {
  const [state, setState] = useState(initial);
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-xl content-center justify-items-center gap-6 p-6">
      {/* A full-width track: the hero Pip sizes against it (min(100%, 22.5rem)). */}
      <div data-qa="pip-single" className="grid w-full place-items-center">
        <PipLazy state={state} size={size} lookAt="cursor" />
      </div>
      <div role="group" aria-label="State" className="flex max-w-xl flex-wrap justify-center gap-2">
        {PIP_STATES.map((s) => (
          <Button key={s} aria-pressed={s === state} onClick={() => setState(s)}>
            {title(s)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Every Pip state at both sizes, for design review and the UI tests (a fixture-only route).
 * `?only=<state>&size=<hero|compact>` shows a single Pip (the perf and motion entries).
 */
export function MascotGallery({ only, size }: { only: PipState | null; size: PipSize | null }) {
  const [follow, setFollow] = useState(true);
  const [worn, setWorn] = useState<readonly PipAccessory[]>([]);
  const [pokes, setPokes] = useState(0);
  const lookAt = follow ? "cursor" : null;

  if (only) return <SinglePip initial={only} size={size ?? "hero"} />;

  const toggle = (name: PipAccessory, on: boolean) =>
    setWorn((list) => (on ? [...list, name] : list.filter((n) => n !== name)));

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 md:px-6 lg:px-10">
      <h1 className="t-large pt-10 lg:pt-16">
        Pip
        <span className="period" aria-hidden="true">
          .
        </span>
      </h1>
      <p className="mt-3 max-w-xl text-label-2">
        Every state at hero and compact size. Poke the big ones.{" "}
        <span aria-live="polite">{pokes ? `Poked ${pokes}×.` : ""}</span>
      </p>

      <section aria-labelledby="pip-options" className="mt-8">
        <h2 id="pip-options" className="t-title3 mb-3">
          Options
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          <li className="flex items-center gap-2">
            <Switch checked={follow} onCheckedChange={setFollow} label="Follow the cursor" />
            <span aria-hidden="true">Follow the cursor</span>
          </li>
          {PIP_ACCESSORIES.map((name) => (
            <li key={name} className="flex items-center gap-2">
              <Switch
                checked={worn.includes(name)}
                onCheckedChange={(on) => toggle(name, on)}
                label={title(name)}
              />
              <span aria-hidden="true">{title(name)}</span>
            </li>
          ))}
        </ul>
      </section>

      <ul className="mt-10 grid gap-4 md:grid-cols-2">
        {PIP_STATES.map((state) => (
          <li
            key={state}
            data-qa="pip-card"
            data-state={state}
            className="rounded-xl bg-elevated p-4 shadow-e1"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
              <PipLazy
                state={state}
                size="hero"
                lookAt={lookAt}
                accessories={worn}
                label={`Pip, ${state}`}
                onPoke={() => setPokes((n) => n + 1)}
              />
              <PipLazy
                state={state}
                size="compact"
                lookAt={lookAt}
                accessories={worn}
                label={`Pip, ${state}, compact`}
              />
            </div>
            <h2 className="t-headline mt-3">{title(state)}</h2>
            <p className="text-label-2">{CAPTIONS[state]}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
