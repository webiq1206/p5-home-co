import Link from "next/link";
import { notFound } from "next/navigation";

import { SECTIONS, articlesInSection } from "../../../../lib/kb/index.ts";
import type { SectionId } from "../../../../lib/kb/types.ts";
import { loadArticleStates } from "../../../../lib/kb/state.ts";

export const dynamic = "force-dynamic";

export default async function KbSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const section = SECTIONS.find((s) => s.id === (id as SectionId));
  if (!section) notFound();

  const articles = articlesInSection(section.id);
  const states = await loadArticleStates();

  return (
    <main className="admin-main">
      <p className="kb-crumbs">
        <Link href="/admin/kb">Knowledge Center</Link> / {section.title}
      </p>
      <h1 className="admin-h1">{section.title}</h1>
      <p className="admin-sub">{section.blurb}</p>

      <div className="kb-article-list">
        {articles.map((article) => {
          const state = states.get(article.slug);
          return (
            <Link key={article.slug} href={`/admin/kb/${article.slug}`} className="kb-article-row">
              <h3>
                {article.title}
                {state?.flagged ? " ⚠" : ""}
              </h3>
              <p>{article.summary}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
