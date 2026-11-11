"use client";

import type { Evidence } from "../../lib/scopes/types.ts";
import { clock, type Workspace } from "./client.ts";

/** Links from a fact to the moment it was said, or the file and page it came from. */
export default function EvidenceLinks({
  evidence,
  assets,
  onPlay,
  projectId,
}: {
  projectId: number;
  evidence: Evidence[];
  assets: Workspace["assets"];
  onPlay: (e: Evidence) => void;
}) {
  if (!evidence?.length) return null;
  const byId = new Map(assets.map((a) => [a.id, a]));
  return (
    <span className="sc-evidence">
      {evidence.slice(0, 6).map((e, i) => {
        const a = byId.get(e.assetId);
        if (!a) return null;
        const audio = a.kind === "recording" || a.kind === "note";
        const title = e.quote ? `"${e.quote}"` : a.label;
        if (audio) {
          return (
            <button key={i} type="button" className="sc-ev" onClick={() => onPlay(e)} title={title} aria-label={`Play ${a.label} at ${clock(e.t ?? 0)}${e.quote ? `: ${e.quote}` : ""}`}>
              ▶ {clock(e.t ?? a.offsetSeconds)}
            </button>
          );
        }
        return (
          <a key={i} className="sc-ev" href={`${assetUrl(projectId, a.id)}${e.page ? `#page=${e.page}` : ""}`} target="_blank" rel="noreferrer" title={title}>
            {a.kind === "photo" ? "Photo" : a.label.slice(0, 24) || "File"}
            {e.page ? ` p.${e.page}` : ""}
          </a>
        );
      })}
    </span>
  );
}

export function assetUrl(projectId: number, assetId: number): string {
  return `/api/scopes/${projectId}/assets/${assetId}`;
}
