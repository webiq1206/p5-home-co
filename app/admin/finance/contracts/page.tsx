/**
 * Contracts and documents (S215).
 *
 * Every document P5 issues, with what it is for, what has to be filled in, and
 * which clauses carry the risk.
 *
 * The review banner is the first thing on the page and cannot be dismissed.
 * These documents decide who pays when something goes wrong and every one of
 * them was drafted by software - which is exactly the situation where
 * confident-looking output does the most damage.
 */

import Link from "next/link";

import {
  ALL_TEMPLATES,
  awaitingReview,
  canIssue,
  loadBearingClauses,
  templatesByCategory,
  type DocumentTemplate,
} from "../../../lib/contracts/index.ts";

export const dynamic = "force-dynamic";

const CATEGORIES: {
  key: DocumentTemplate["category"];
  label: string;
  blurb: string;
}[] = [
  {
    key: "client",
    label: "Customer agreements",
    blurb: "What P5 signs with a homeowner.",
  },
  {
    key: "subcontractor",
    label: "Subcontractor agreements",
    blurb:
      "A master agreement signed once per subcontractor, then a one-page work order per job.",
  },
  {
    key: "change",
    label: "Change orders",
    blurb: "Used on both sides - with the customer and with the subcontractor.",
  },
  {
    key: "waiver",
    label: "Lien waivers",
    blurb:
      "Four forms. Which one to use is decided by whether the payment has cleared, never by which is to hand.",
  },
  {
    key: "disclosure",
    label: "Required disclosures",
    blurb: "Documents Idaho law requires before residential work begins.",
  },
];

export default function ContractsPage() {
  const unreviewed = awaitingReview();
  const risky = loadBearingClauses();

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Contracts and documents</h1>
      <p className="admin-sub">
        Every document P5 issues, with the fields it needs and the clauses that
        carry the risk.
      </p>

      {unreviewed.length > 0 && (
        <div className="admin-notice admin-notice-error">
          <strong>
            {unreviewed.length} of {ALL_TEMPLATES.length} templates have not been
            reviewed by an attorney
          </strong>
          These documents decide who pays when something goes wrong, and they
          were drafted from templates rather than by a lawyer. They are usable
          as a starting point for review - a lawyer reading a complete draft
          costs far less than one drafting from scratch - but nothing here
          should be signed, sent to a customer or subcontractor, or relied on
          until counsel has been through it. Every document produced from an
          unreviewed template prints that warning on its own face.
        </div>
      )}

      {CATEGORIES.map((category) => {
        const templates = templatesByCategory(category.key);
        if (templates.length === 0) return null;
        return (
          <section className="fin-section" key={category.key}>
            <h2>{category.label}</h2>
            <p className="fin-footnote">{category.blurb}</p>

            {templates.map((template) => {
              const issue = canIssue(template);
              return (
                <article className="fin-finding" key={template.key}>
                  <h3>{template.title.replace(/\{\{.*?\}\}/g, "").trim()}</h3>
                  <p>{template.purpose}</p>

                  <p>
                    <span
                      className={`fin-chip fin-chip-${
                        issue.allowed ? "green" : "warning"
                      }`}
                    >
                      {issue.allowed ? "Approved by counsel" : "Not yet reviewed"}
                    </span>
                    {template.statute && (
                      <span className="fin-chip fin-chip-info">
                        {template.statute}
                      </span>
                    )}
                  </p>

                  {template.issuingNotes && (
                    <ul>
                      {template.issuingNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}

                  {/* What the pre-send gate will check. Shown on the template
                      itself, so the requirement is known before somebody is
                      halfway through preparing a contract and discovers it. */}
                  {(template.exhibits?.length ?? 0) > 0 && (
                    <>
                      <h4>Before this can be sent</h4>
                      <ul>
                        {template.exhibits!.map((ex) => (
                          <li key={ex.label}>
                            <strong>
                              {ex.label}: {ex.name}
                            </strong>{" "}
                            {ex.required ? (
                              <span className="fin-chip fin-chip-urgent">
                                blocks sending
                              </span>
                            ) : (
                              <span className="fin-chip fin-chip-info">
                                you will be asked
                              </span>
                            )}
                            <br />
                            <span className="fin-footnote">{ex.purpose}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="fin-footnote">
                        A required exhibit stops the send. An optional one only
                        asks, and is answered either by attaching it or by
                        confirming there is none for this job. A gate that blocks
                        on things legitimately absent gets clicked through on
                        reflex, and then it stops being a gate.
                      </p>
                    </>
                  )}

                  <details>
                    <summary>
                      What has to be filled in (
                      {template.fields.filter((f) => f.required).length} required)
                    </summary>
                    <div className="fin-table-wrap">
                      <table className="fin-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Required</th>
                            <th>Comes from</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {template.fields.map((field) => (
                            <tr key={field.key}>
                              <td>{field.label}</td>
                              <td>{field.required ? "Yes" : "Optional"}</td>
                              <td>{field.source ?? "Typed in"}</td>
                              <td>{field.help ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="fin-footnote">
                      A document cannot be produced while a required field is
                      empty. That is a refusal, not a warning: a subcontract
                      that goes out reading &quot;retainage of ___ percent&quot;
                      looks signed and is unenforceable on precisely the term
                      that gets argued about.
                    </p>
                  </details>

                  <details>
                    <summary>Read the full text ({template.clauses.length} clauses)</summary>
                    {template.clauses.map((clause) => (
                      <div key={clause.heading}>
                        <h4>
                          {clause.heading}
                          {clause.loadBearing && (
                            <>
                              {" "}
                              <span className="fin-chip fin-chip-urgent">
                                carries risk
                              </span>
                            </>
                          )}
                        </h4>
                        <pre className="fin-pre">{clause.body}</pre>
                        {clause.rationale && (
                          <p className="fin-footnote">
                            <strong>Why this clause is here:</strong>{" "}
                            {clause.rationale}
                          </p>
                        )}
                      </div>
                    ))}
                  </details>
                </article>
              );
            })}
          </section>
        );
      })}

      <section className="fin-section">
        <h2>The clauses to escalate rather than concede</h2>
        <p>
          When a subcontractor or a customer sends back a marked-up document,
          these are the {risky.length} clauses where a change costs real money.
          Everything else is worth conceding to get a signature; these are worth
          a phone call to counsel.
        </p>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Clause</th>
                <th>What it protects</th>
              </tr>
            </thead>
            <tbody>
              {risky.map((c) => (
                <tr key={`${c.template}-${c.heading}`}>
                  <td>{c.template.replace(/\{\{.*?\}\}/g, "").trim()}</td>
                  <td>{c.heading}</td>
                  <td>{c.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Getting these reviewed</h2>
        <p>
          The useful thing to send an attorney is the complete set, together
          with what each document is for. Reviewing a finished draft is a much
          smaller job than drafting from nothing, and the rationale recorded
          against each risk-carrying clause tells counsel what the clause is
          meant to achieve - so a redline can improve it rather than
          accidentally remove the protection.
        </p>
        <p className="fin-footnote">
          When counsel approves a template, its review state and the reviewer
          are recorded against it. Nothing marks itself approved - that is a
          person&apos;s decision and has to be entered as one.
        </p>
        <p>
          <Link href="/admin/kb/contracts-and-documents">
            How these documents fit together, in the Knowledge Center
          </Link>
        </p>
      </section>
    </main>
  );
}
