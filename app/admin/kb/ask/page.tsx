/**
 * Ask P5. Answers come only from the curated bank and the article text -
 * there is no generative step, so an answer can never be invented. When
 * confidence is too low, the page says so and offers the nearest pages.
 */

import Link from "next/link";

import { ask } from "../../../lib/kb/ask.ts";
import { SECTIONS } from "../../../lib/kb/index.ts";

const EXAMPLES = [
  "How do I enter a subcontractor bill?",
  "What happens when a lead becomes a customer?",
  "How do I see how much money is left on a project?",
  "Who needs to approve this bill?",
  "What happens after an estimate is accepted?",
  "Where do I see outstanding customer invoices?",
];

export default async function AskP5({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const question = (q ?? "").trim();
  const answer = question ? ask(question) : null;

  return (
    <main className="admin-main">
      <p className="kb-crumbs">
        <Link href="/admin/kb">Knowledge Center</Link> / Ask P5
      </p>
      <h1 className="admin-h1">Ask P5</h1>
      <p className="admin-sub">
        Ask in plain English. Answers come from the P5 documentation and the
        real configuration - never from guessing.
      </p>

      <form action="/admin/kb/ask" method="get" className="kb-search-form">
        <input
          type="search"
          name="q"
          defaultValue={question}
          placeholder="Ask a question..."
          aria-label="Ask P5 a question"
        />
        <button className="lead-action lead-action-primary" type="submit">
          Ask
        </button>
      </form>

      {!answer && (
        <div className="kb-links" style={{ marginTop: 10 }}>
          <b>Try one of these</b>
          {EXAMPLES.map((ex) => (
            <Link key={ex} href={`/admin/kb/ask?q=${encodeURIComponent(ex)}`}>
              {ex}
            </Link>
          ))}
        </div>
      )}

      {answer?.kind === "answer" && (
        <>
          <div className="kb-answer kb-article">
            {answer.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {answer.steps && (
              <ol className="kb-steps">
                {answer.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            {answer.automatic && (
              <aside className="kb-callout kb-callout-automatic">
                <b className="kb-callout-tag">P5 does this automatically</b>
                <span>{answer.automatic}</span>
              </aside>
            )}
            {answer.action && (
              <aside className="kb-callout kb-callout-action">
                <b className="kb-callout-tag">You need to do this</b>
                <span>{answer.action}</span>
              </aside>
            )}
            <nav className="kb-links" style={{ marginBottom: 0 }}>
              <b>Read the full pages</b>
              {answer.links.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label} →
                </Link>
              ))}
            </nav>
          </div>
          {answer.related.length > 0 && (
            <div className="kb-article-list">
              {answer.related.map((r) => (
                <Link key={r.article.slug} href={`/admin/kb/${r.article.slug}`} className="kb-article-row">
                  <h3>{r.article.title}</h3>
                  <p>{r.article.summary}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {answer?.kind === "page" && (
        <>
          <div className="kb-answer kb-article">
            <p>{answer.intro}</p>
          </div>
          <div className="kb-article-list">
            {answer.results.map((r) => {
              const section = SECTIONS.find((s) => s.id === r.article.section);
              return (
                <Link key={r.article.slug} href={`/admin/kb/${r.article.slug}`} className="kb-article-row">
                  <h3>{r.article.title}</h3>
                  <p>
                    {section?.title} · {r.article.summary}
                  </p>
                  <p className="kb-snippet">{r.snippet}</p>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {answer?.kind === "unknown" && (
        <>
          <div className="kb-answer kb-unknown kb-article">
            <p>{answer.message}</p>
          </div>
          {answer.suggestions.length > 0 && (
            <>
              <p className="admin-sub">Closest pages, in case one of these is what you meant:</p>
              <div className="kb-article-list">
                {answer.suggestions.map((r) => (
                  <Link key={r.article.slug} href={`/admin/kb/${r.article.slug}`} className="kb-article-row">
                    <h3>{r.article.title}</h3>
                    <p>{r.article.summary}</p>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
