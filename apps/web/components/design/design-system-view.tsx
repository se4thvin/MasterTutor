"use client";

import type { ComponentType } from "react";
import { ControlsSection } from "./sections/controls.tsx";
import { FoundationsSection } from "./sections/foundations.tsx";
import { IconGallerySection } from "./sections/icon-gallery.tsx";
import { OverlaysSection } from "./sections/overlays.tsx";
import { ToastsSection } from "./sections/toasts.tsx";

/** Later tasks append their section component here. */
const SECTIONS: ReadonlyArray<{ id: string; title: string; Section: ComponentType }> = [
  { id: "foundations", title: "Foundations", Section: FoundationsSection },
  { id: "icons", title: "Icons", Section: IconGallerySection },
  { id: "controls", title: "Controls", Section: ControlsSection },
  { id: "overlays", title: "Overlays", Section: OverlaysSection },
  { id: "toasts", title: "Toasts", Section: ToastsSection },
];

export function DesignSystemView() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 md:px-6 lg:px-10">
      <h1 className="t-large pt-10 lg:pt-16">
        Design system
        <span className="period" aria-hidden="true">
          .
        </span>
      </h1>
      <p className="mt-3 max-w-xl text-label-2">
        Every token and shared component, at every breakpoint.
      </p>
      {SECTIONS.map(({ id, title, Section }) => (
        <section
          key={id}
          id={id}
          data-qa="design-section"
          aria-labelledby={`${id}-title`}
          className="mt-12"
        >
          <h2 id={`${id}-title`} className="t-title2 mb-4">
            {title}
          </h2>
          <Section />
        </section>
      ))}
    </div>
  );
}
