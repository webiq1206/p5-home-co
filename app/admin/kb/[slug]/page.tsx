/**
 * One Knowledge Center article: last-verified badge, drift flag when the
 * live systems disagree with the page, the content, and prev/next within
 * the section so reading in order needs no navigation thought.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { SECTIONS, articlesInSection, getArticle } from "../../../lib/kb/index.ts";
import { loadArticleStates } from "../../../lib/kb/state.ts";
import { RenderArticle } from "../render.tsx";

export const dynamic = "force-dynamic";

function pretty(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const states = await loadArticleStates();
  const state = states.get(article.slug);
  const section = SECTIONS.find((s) => s.id === article.section);
  const siblings = articlesInSection(article.section);
  const idx = siblings.findIndex((a) => a.slug === article.slug);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const lastVerified = state?.lastVerifiedOn ?? article.lastVerified;

  return (
    <main className="admin-main">
      <p className="kb-crumbs">
        <Link href="/admin/kb">Knowledge Center</Link> /{" "}
        <Link href={`/admin/kb/section/${article.section}`}>{section?.title}</Link>
      </p>
      <h1 className="admin-h1">{article.title}</h1>
      <p className="admin-sub">{article.summary}</p>

      {state?.flagged ? (
        <div className="kb-flagged">
          <strong>This page may be out of date.</strong>
          The nightly check found the live configuration no longer matches this
          page: {state.flagReason ?? "a watched setting changed."} An
          administrator should review it - and either update the page or revert
          the configuration.
        </div>
      ) : (
        <p className="kb-verified">
          ✓ Last verified against the live systems on {pretty(lastVerified)}
        </p>
      )}

      <RenderArticle article={article} />

      <nav className="kb-prev-next" aria-label="Section navigation">
        <span>
          {prev && (
            <Link href={`/admin/kb/${prev.slug}`}>← {prev.title}</Link>
          )}
        </span>
        <span style={{ textAlign: "right" }}>
          {next && (
            <Link href={`/admin/kb/${next.slug}`}>{next.title} →</Link>
          )}
        </span>
      </nav>
    </main>
  );
}
