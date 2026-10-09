import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MascotGallery } from "@/components/design/mascot-gallery.tsx";
import { PIP_STATES, type PipState } from "@/components/mascot/pip-types.ts";

export const metadata: Metadata = { title: "Pip" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

/** Pip's gallery: a development and UI-test page; production builds answer 404 (D48). */
export default async function MascotPage({ searchParams }: { searchParams: Search }) {
  if (!__FIXTURE_BUILD__) notFound();
  const params = await searchParams;
  const only = one(params["only"]);
  const size = one(params["size"]);
  return (
    <MascotGallery
      only={PIP_STATES.includes(only as PipState) ? (only as PipState) : null}
      size={size === "hero" || size === "compact" ? size : null}
    />
  );
}
