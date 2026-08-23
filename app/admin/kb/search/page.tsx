/**
 * Knowledge Center search. A plain GET form - works with no JavaScript,
 * bookmarkable, and fast. Synonyms mean "pay subcontractor" finds the AP
 * pages even though nobody wrote that exact phrase.
 */

import Link from "next/link";

import { ALL_ARTICLES, SECTIONS } from "../../../lib/kb/index.ts";
import { buildIndex, search } from "../../../lib/kb/search.ts";

const INDEX = buildIndex(ALL_ARTICLES);

export default async function KbSearch({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const results = query ? search(query, INDEX, 10) : [];

  return (
    <main className="admin-main">
      <p className="kb-crumbs">
        <Link href="/admin/kb">Knowledge Center</Link> / Search
      </p>
      <h1 className="admin-h1">Search</h1>
      <p className="admin-sub">
        Plain words work: try &ldquo;pay subcontractor&rdquo;, &ldquo;new
        lead&rdquo;, &ldquo;change order&rdquo;, or &ldquo;remaining project
        budget&rdquo;.
      </p>

      <form action="/admin/kb/search" method="get" className="kb-search-form" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="What do you need to do?"
          aria-label="Search the Knowledge Center"
        />
        <button className="lead-action lead-action-primary" type="submit">
          Search
        </button>
      </form>

      {query &&
        (results.length === 0 ? (
          <div className="admin-empty">
            <h2>No pages match.</h2>
            <p>
              Try different words, or{" "}
              <Link href={`/admin/kb/ask?q=${encodeURIComponent(query)}`} style={{ fontWeight: 650 }}>
                ask P5 the question directly
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="kb-article-list">
            {results.map((result) => {
              const section = SECTIONS.find((s) => s.id === result.article.section);
              return (
                <Link
                  key={result.article.slug}
                  href={`/admin/kb/${result.article.slug}`}
                  className="kb-article-row"
                >
                  <h3>{result.article.title}</h3>
                  <p>
                    {section?.title} · {result.article.summary}
                  </p>
                  <p className="kb-snippet">{result.snippet}</p>
                </Link>
              );
            })}
          </div>
        ))}
    </main>
  );
}
