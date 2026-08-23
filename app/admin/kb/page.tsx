/**
 * Knowledge Center home: search, Ask P5, the section grid, and an honest
 * freshness banner when any page is flagged by the drift check.
 */

import Link from "next/link";

import { ALL_ARTICLES, SECTIONS, articlesInSection } from "../../lib/kb/index.ts";
import { loadArticleStates } from "../../lib/kb/state.ts";

export const dynamic = "force-dynamic";

export default async function KbHome() {
  const states = await loadArticleStates();
  const flagged = ALL_ARTICLES.filter((a) => states.get(a.slug)?.flagged);

  return (
    <main className="admin-main kb-wide">
      <h1 className="admin-h1">Knowledge Center</h1>
      <p className="admin-sub">
        How P5 Home Co runs: QuickBooks, HubSpot, and the P5 panel - written for
        someone who has never used any of them. Documentation is checked
        against the live systems every night.
      </p>

      <form action="/admin/kb/search" method="get" className="kb-search-form" role="search">
        <input
          type="search"
          name="q"
          placeholder='Search - try "pay subcontractor" or "change order"'
          aria-label="Search the Knowledge Center"
        />
        <button className="lead-action lead-action-primary" type="submit">
          Search
        </button>
      </form>
      <form action="/admin/kb/ask" method="get" className="kb-search-form">
        <input
          type="search"
          name="q"
          placeholder='Ask P5 a question - "Who needs to approve this bill?"'
          aria-label="Ask P5 a question"
        />
        <button className="lead-action" type="submit">
          Ask P5
        </button>
      </form>
      <p className="kb-form-hint">
        Search finds pages; Ask P5 answers plain-English questions from these
        pages - and says so honestly when it cannot.
      </p>

      {flagged.length > 0 && (
        <div className="admin-notice">
          <strong>
            {flagged.length} page{flagged.length === 1 ? "" : "s"} flagged for review
          </strong>
          The live configuration changed and no longer matches:{" "}
          {flagged.map((a, i) => (
            <span key={a.slug}>
              {i > 0 && ", "}
              <Link href={`/admin/kb/${a.slug}`} style={{ fontWeight: 650 }}>
                {a.title}
              </Link>
            </span>
          ))}
          . Each page shows exactly what differs.
        </div>
      )}

      <div className="kb-sections">
        {SECTIONS.map((section) => {
          const articles = articlesInSection(section.id);
          return (
            <Link
              key={section.id}
              href={`/admin/kb/section/${section.id}`}
              className="kb-section-card"
            >
              <h2>{section.title}</h2>
              <p>{section.blurb}</p>
              <small>
                {articles.length} page{articles.length === 1 ? "" : "s"}
              </small>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
