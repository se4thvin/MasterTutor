"use client";

import type { NoteDetail } from "@mastertutor/contracts";
import Link from "next/link";
import { FidelityBadge } from "@/components/library/fidelity-badge.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { SOURCE_KIND_ICON } from "@/components/ui/icons.ts";
import { formatDateTime, hostOf, pathOf } from "@/lib/notes/format.ts";
import { safePageUrl } from "@/lib/notes/provenance.ts";
import { AssetImage } from "./asset-image.tsx";

export function SourceStrip({ detail }: { detail: NoteDetail }) {
  const verified = detail.blocks.filter((b) => b.verified && b.origin !== "model").length;
  const captured = detail.blocks.filter((b) => b.origin !== "model").length;
  return (
    <div className="srcstrip">
      {detail.sources.map((s) => {
        const label = (
          <>
            <b>{hostOf(s.url)}</b>
            <span className="srcstrip-path">{pathOf(s.url)}</span>
          </>
        );
        return (
          <span key={s.id} className="srcstrip-source">
            {s.faviconAssetId ? (
              <AssetImage assetId={s.faviconAssetId} alt="" className="srcstrip-fav" />
            ) : (
              <Icon name={SOURCE_KIND_ICON[s.kind]} />
            )}
            {safePageUrl(s.url) ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="srcstrip-url">
                {label}
              </a>
            ) : (
              <span className="srcstrip-url">{label}</span>
            )}
            <span className="t-foot srcstrip-time">
              <Icon name="session" size="sm" /> Captured {formatDateTime(s.capturedAt)}
            </span>
          </span>
        );
      })}
      <span className="srcstrip-right">
        <FidelityBadge fidelity={detail.note.fidelity} coverage={detail.note.coverage} />
        <span className="t-foot">
          {verified} of {captured} verified
        </span>
        {detail.note.runId ? (
          <Link href={`/runs/${detail.note.runId}`} className="t-foot">
            Run {detail.note.runId.slice(-6)}
          </Link>
        ) : null}
      </span>
    </div>
  );
}
