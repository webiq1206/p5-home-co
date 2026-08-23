/**
 * Block renderer: turns an article's typed blocks into the page. Server
 * component - no client JS is needed to read documentation.
 */

import Link from "next/link";

import type { Article, Block, CalloutKind, FlowStep } from "../../lib/kb/types.ts";

const CALLOUT_TAG: Record<CalloutKind, string> = {
  automatic: "P5 does this automatically",
  action: "You need to do this",
  review: "Review required",
  warning: "Warning",
  info: "Good to know",
};

function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function FlowSteps({ steps, title }: { steps: FlowStep[]; title?: string }) {
  return (
    <div className="kb-flow">
      {title && <p className="kb-flow-title">{title}</p>}
      {steps.map((step, i) => (
        <div
          key={i}
          className={`kb-flow-step${step.kind === "auto" ? " kb-flow-auto" : step.kind === "review" ? " kb-flow-review" : ""}`}
        >
          <div className="kb-flow-label">
            <span>{step.label}</span>
            {step.kind && (
              <span className="kb-flow-kind">
                {step.kind === "auto" ? "Automatic" : step.kind === "review" ? "Review" : "A person"}
              </span>
            )}
          </div>
          {step.detail && <p className="kb-flow-detail">{step.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export function RenderBlock({ block }: { block: Block }) {
  switch (block.t) {
    case "p":
      return <p>{block.text}</p>;
    case "h":
      return (
        <h2 className="kb-h2" id={slugifyHeading(block.text)}>
          {block.text}
        </h2>
      );
    case "steps":
      return (
        <>
          {block.title && <p style={{ marginBottom: 8, fontWeight: 650 }}>{block.title}</p>}
          <ol className="kb-steps">
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </>
      );
    case "list":
      return (
        <ul className="kb-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <aside className={`kb-callout kb-callout-${block.kind}`}>
          <b className="kb-callout-tag">{CALLOUT_TAG[block.kind]}</b>
          {block.title && <strong className="kb-callout-title">{block.title}</strong>}
          <span>{block.text}</span>
        </aside>
      );
    case "table":
      return (
        <div className="kb-table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "flow":
      return <FlowSteps steps={block.steps} title={block.title} />;
    case "faq":
      return (
        <div className="kb-faq">
          {block.items.map((item, i) => (
            <details key={i}>
              <summary>{item.q}</summary>
              <div>{item.a}</div>
            </details>
          ))}
        </div>
      );
    case "terms":
      return (
        <dl className="kb-terms">
          {block.items.map((item, i) => (
            <div key={i}>
              <dt>{item.term}</dt>
              <dd>{item.def}</dd>
            </div>
          ))}
        </dl>
      );
    case "links":
      return (
        <nav className="kb-links">
          <b>{block.title ?? "Related pages"}</b>
          {block.items.map((item, i) => (
            <Link key={i} href={item.href}>
              {item.label} →
            </Link>
          ))}
        </nav>
      );
  }
}

export function RenderArticle({ article }: { article: Article }) {
  return (
    <div className="kb-article">
      {article.blocks.map((block, i) => (
        <RenderBlock key={i} block={block} />
      ))}
    </div>
  );
}
