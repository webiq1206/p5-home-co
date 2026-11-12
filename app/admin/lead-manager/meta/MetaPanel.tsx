"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { BRANDS } from "../../../lib/leads/types.ts";
import {
  assignMetaMapping,
  refreshMetaPages,
  selfTestMetaHandshake,
  subscribeAllMetaPages,
  reprocessMetaReceipt,
  type MetaActionResult,
} from "./actions.ts";
import type { MetaPage } from "../../../lib/integrations/meta-admin.ts";
import type { metaAdminSnapshot } from "../../../lib/integrations/meta-admin.ts";

export type MetaSnapshot = Awaited<ReturnType<typeof metaAdminSnapshot>>;

const SECRET_LABELS: Record<string, string> = {
  META_LEADGEN_VERIFY_TOKEN: "Webhook verification token",
  META_APP_SECRET: "Meta app secret",
  META_PAGE_ACCESS_TOKEN: "System-user access token",
  META_PAGE_TOKENS: "Per-Page overrides (optional)",
  HUBSPOT_TOKEN: "HubSpot private-app token",
  SMTP_USER: "SMTP username",
  SMTP_PASSWORD: "SMTP password",
};

function StatusPill({ good, children }: { good: boolean; children: ReactNode }) {
  return (
    <span className="lead-tag" style={{ borderColor: good ? "var(--moss)" : "#9a2f2f", color: good ? "var(--moss)" : "#8d3030" }}>
      {children}
    </span>
  );
}

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function MetaPanel({ snapshot }: { snapshot: MetaSnapshot | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastAction, setLastAction] = useState("");

  function runAction(label: string, action: () => Promise<MetaActionResult>) {
    setLastAction(label);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.pages) setPages(result.pages);
        const partialDiscovery = label === "Refresh Pages" && result.pages?.some((page) => page.error);
        setNotice({
          ok: result.ok && !partialDiscovery,
          message: partialDiscovery
            ? "Page discovery completed with individual Page errors. Review each Page before treating intake as ready."
            : result.message,
        });
      } catch {
        setNotice({ ok: false, message: `${label} could not complete. Check administrator access and integration configuration.` });
      }
    });
  }

  function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLastAction("Save mapping");
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await assignMetaMapping(form);
        setNotice({ ok: result.ok, message: result.message });
        if (result.ok) router.refresh();
      } catch {
        setNotice({ ok: false, message: "Mapping was not saved. Check administrator access and database availability." });
      }
    });
  }

  const mappings = snapshot?.mappings;
  const receipts = snapshot?.receipts ?? [];
  const readiness = snapshot?.readiness;
  const mappingRows = [
    ...Object.entries(mappings?.pages ?? {}).map(([id, brand]) => ({ kind: "pages" as const, id, brand, formName: "", service: "" })),
    ...Object.entries(mappings?.forms ?? {}).map(([id, form]) => ({ kind: "forms" as const, id, brand: form.brand, formName: form.formName, service: form.service })),
  ];

  return (
    <div>
      <section className="lead-panel" aria-labelledby="meta-ready-heading">
        <div className="lead-top">
          <h2 id="meta-ready-heading">Intake readiness</h2>
          <StatusPill good={Boolean(readiness?.appId && Object.entries(readiness.secrets).filter(([key]) => key !== "META_PAGE_TOKENS").every(([, present]) => present))}>
            {readiness?.appId && Object.entries(readiness.secrets).filter(([key]) => key !== "META_PAGE_TOKENS").every(([, present]) => present) ? "Credentials present · not validated" : "Setup required"}
          </StatusPill>
        </div>
        {!snapshot || !readiness ? (
          <div className="admin-notice admin-notice-error" role="status">
            <strong>Meta intake status is unavailable.</strong>
            The settings or receipt store could not be read. Check database availability; details are withheld here.
          </div>
        ) : (
          <>
            <p className="lead-note" style={{ margin: "8px 0 16px" }}>
              Presence only—credential values are never displayed. A missing required credential blocks live intake.
            </p>
            <div className="admin-stats">
              {Object.entries(readiness.secrets).map(([key, present]) => (
                <div className="admin-stat" key={key}>
                  <StatusPill good={present}>{present ? "Present" : "Missing"}</StatusPill>
                  <span style={{ display: "block", marginTop: 8 }}>{SECRET_LABELS[key] ?? key}</span>
                </div>
              ))}
              <div className="admin-stat">
                <b style={{ fontSize: 16 }}>{readiness.appId ?? "Not set"}</b>
                <span>Meta app ID</span>
              </div>
              <div className="admin-stat">
                <StatusPill good={readiness.smtpEnabled}>{readiness.smtpEnabled ? "Configured" : "Not configured"}</StatusPill>
                <span style={{ display: "block", marginTop: 8 }}>SMTP config only · no message sent</span>
              </div>
            </div>
            <ul className="dash-notes">
              <li>Page discovery runs only when you choose Refresh Pages; this screen does not contact Meta during render.</li>
              <li>The boot and nightly intake scheduler run in production only. Missing credentials block intake readiness.</li>
              <li>SMTP status reflects configuration checks only, not a delivery test.</li>
            </ul>
          </>
        )}
      </section>

      <section className="lead-panel" aria-labelledby="mapping-heading">
        <h2 id="mapping-heading">Brand routing</h2>
        <p className="dash-panel-hint">Merged default and saved assignments. Save changes per Page or form; future lead processing uses that brand.</p>
        <div style={{ display: "grid", gap: 12 }}>
          {mappingRows.length === 0 && (
            <div className="admin-empty">
              <h2>No mappings available</h2>
              <p>Mapping data could not be loaded.</p>
            </div>
          )}
          {mappingRows.map((row) => (
            <form className="dash-panel" key={`${row.kind}-${row.id}`} onSubmit={saveMapping}>
              <input type="hidden" name="kind" value={row.kind} />
              <input type="hidden" name="id" value={row.id} />
              <div className="lead-top" style={{ marginBottom: 12 }}>
                <strong>{row.kind === "pages" ? "Page mapping" : "Lead form mapping"}</strong>
                <code style={{ overflowWrap: "anywhere" }}>{row.id}</code>
              </div>
              <div className="lead-meta-wide lead-meta">
                <label className="lead-field">
                  <span>Brand</span>
                  <select name="brand" defaultValue={row.brand} disabled={pending}>
                    {BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                  </select>
                </label>
                {row.kind === "forms" && (
                  <>
                    <label className="lead-field">
                      <span>Form name</span>
                      <input name="formName" defaultValue={row.formName} maxLength={300} disabled={pending} />
                    </label>
                    <label className="lead-field">
                      <span>Service</span>
                      <input name="service" defaultValue={row.service} maxLength={100} disabled={pending} />
                    </label>
                  </>
                )}
              </div>
              <div className="lead-actions">
                <button className="lead-action lead-action-primary" type="submit" disabled={pending}>
                  {pending && lastAction === "Save mapping" ? "Saving…" : "Save mapping"}
                </button>
              </div>
            </form>
          ))}
        </div>
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Add a Page or form mapping</summary>
          <form className="lead-form" onSubmit={saveMapping} style={{ marginTop: 14 }}>
            <label className="lead-field"><span>Mapping type</span>
              <select name="kind" defaultValue="pages" disabled={pending}>
                <option value="pages">Page</option><option value="forms">Lead form</option>
              </select>
            </label>
            <label className="lead-field"><span>Meta ID</span>
              <input name="id" inputMode="numeric" pattern="[0-9]{1,40}" required disabled={pending} />
            </label>
            <label className="lead-field"><span>Brand</span>
              <select name="brand" defaultValue={BRANDS[0]} disabled={pending}>
                {BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
            </label>
            <label className="lead-field"><span>Form name <small>forms only</small></span>
              <input name="formName" maxLength={300} disabled={pending} />
            </label>
            <label className="lead-field"><span>Service <small>forms only</small></span>
              <input name="service" maxLength={100} disabled={pending} />
            </label>
            <button className="lead-action lead-action-primary" type="submit" disabled={pending}>Add mapping</button>
          </form>
        </details>
      </section>

      <section className="lead-panel" aria-labelledby="pages-heading">
        <div className="lead-top">
          <h2 id="pages-heading">Meta Pages & lead forms</h2>
          <div className="lead-actions" style={{ margin: 0 }}>
            <button className="lead-action" type="button" disabled={pending} onClick={() => runAction("Refresh Pages", refreshMetaPages)}>
              {pending && lastAction === "Refresh Pages" ? "Refreshing…" : "Refresh Pages"}
            </button>
            <button className="lead-action lead-action-primary" type="button" disabled={pending}
              onClick={() => {
                if (window.confirm("Subscribe every discovered Page to leadgen updates? This changes Meta Page subscriptions.")) {
                  runAction("Subscribe all pages", subscribeAllMetaPages);
                }
              }}>
              {pending && lastAction === "Subscribe all pages" ? "Checking subscriptions…" : "Subscribe all pages"}
            </button>
            <button className="lead-action" type="button" disabled={pending} onClick={() => runAction("Run self-test", selfTestMetaHandshake)}>
              {pending && lastAction === "Run self-test" ? "Testing…" : "Run self-test"}
            </button>
          </div>
        </div>
        <p className="dash-panel-hint">Subscription is an explicit Meta mutation. Review per-Page results; a partial result is never reported as success. Self-test checks the same-origin webhook challenge only.</p>
        {notice && <p className={notice.ok ? "lead-ok" : "lead-error-block"} role="status">{notice.message}</p>}
        {pending && <p className="lead-note" aria-live="polite">Working… {lastAction}</p>}
        {pages === null ? (
          <div className="admin-empty">
            <h2>Discovery has not been run</h2>
            <p>Choose Refresh Pages to inspect accessible Pages, subscriptions, and lead forms.</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="admin-empty"><h2>No Pages returned</h2><p>Check Page access and server integration configuration.</p></div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {pages.map((page) => (
              <article className={`lead-card${page.error ? " lead-card-warn" : ""}`} key={page.id}>
                <div className="lead-top">
                  <h3 className="lead-name">{page.name}</h3>
                  <code style={{ overflowWrap: "anywhere" }}>{page.id}</code>
                </div>
                <div className="lead-tags">
                  <span className="lead-tag">Leadgen subscription: {page.subscribed === null ? "Unknown" : page.subscribed ? "Active" : "Inactive"}</span>
                  <span className="lead-tag">App {page.appId}: {page.appPresent === null ? "Unknown" : page.appPresent ? "Present" : "Not listed"}</span>
                  <span className="lead-tag lead-tag-brand">Mapped brand: {mappings?.pages[page.id] ?? "Unassigned"}</span>
                </div>
                {page.error && <p className="lead-error-block" style={{ marginTop: 12 }}>{page.error}</p>}
                {page.forms.length === 0 ? <p className="lead-note" style={{ marginTop: 12 }}>No forms returned for this Page.</p> : (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    {page.forms.map((form) => (
                      <div key={form.id} className="dash-panel">
                        <div className="lead-top">
                          <strong>{form.name}</strong><code style={{ overflowWrap: "anywhere" }}>{form.id}</code>
                        </div>
                        <div className="lead-tags">
                          <span className="lead-tag">Status: {form.status}</span>
                          <span className="lead-tag lead-tag-brand">Resolved brand: {form.brand}</span>
                          <span className="lead-tag">Source: {form.resolvedBy}</span>
                        </div>
                        <form onSubmit={saveMapping} className="lead-actions" style={{ alignItems: "end" }}>
                          <input type="hidden" name="kind" value="forms" />
                          <input type="hidden" name="id" value={form.id} />
                          <input type="hidden" name="formName" value={form.name} />
                          <label className="lead-field" style={{ minWidth: 210 }}>
                            <span>Assign brand</span>
                            <select name="brand" defaultValue={form.brand} disabled={pending}>
                              {BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                            </select>
                          </label>
                          <label className="lead-field" style={{ minWidth: 180 }}>
                            <span>Service</span>
                            <input name="service" defaultValue={mappings?.forms[form.id]?.service ?? ""} maxLength={100} disabled={pending} />
                          </label>
                          <button className="lead-action" type="submit" disabled={pending}>Save form assignment</button>
                        </form>
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ cursor: "pointer", color: "var(--ink-2)", fontSize: 12, fontWeight: 700 }}>
                            Questions ({form.questions.length})
                          </summary>
                          {form.questions.length ? (
                            <ul className="dash-list">
                              {form.questions.map((question, index) => (
                                <li key={`${question.key ?? question.label ?? "question"}-${index}`}>
                                  <span className="dash-list-main">{question.label ?? question.key ?? "Unnamed question"}</span>
                                  <span className="dash-list-note">{[question.key, question.type].filter(Boolean).join(" · ") || "No field metadata"}</span>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="lead-note">No question metadata returned.</p>}
                        </details>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="lead-panel" aria-labelledby="receipts-heading">
        <div className="lead-top">
          <h2 id="receipts-heading">Recent intake receipts</h2>
          <span className="lead-tag">{receipts.length} of 20</span>
        </div>
        <p className="dash-panel-hint">Operational audit trail only. No retry or lead-generation controls are available here.</p>
        {!snapshot ? <p className="lead-note">Receipt data is unavailable.</p> : receipts.length === 0 ? (
          <div className="admin-empty"><h2>No receipts yet</h2><p>Accepted Meta webhook events will appear here when available.</p></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>{["State / sync", "Leadgen ID", "Page ID", "Form ID", "HubSpot contact", "HubSpot deal", "Attempts", "Lease until", "Last error", "Retry at", "Received", "Updated"].map((heading) => (
                <th key={heading} style={{ padding: "10px 8px", borderBottom: "2px solid var(--line)", textAlign: "left", color: "var(--ink-2)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>{heading}</th>
              ))}</tr></thead>
              <tbody>{receipts.map((receipt) => (
                <tr key={`${receipt.leadgen_id}-${receipt.received_at}`}>
                  <td style={cellStyle}><strong>{receipt.state}</strong><br />{receipt.sync_status ?? "—"}
                    {receipt.state === "rejected" && (
                      <button className="lead-action" type="button" disabled={pending}
                        onClick={() => {
                          if (window.confirm("Reprocess this rejected receipt? This may create a HubSpot contact/deal/note and send the new-lead alert email.")) {
                            runAction("Reprocess", async () => {
                              const result = await reprocessMetaReceipt(receipt.leadgen_id);
                              router.refresh();
                              return result;
                            });
                          }
                        }}>Reprocess</button>
                    )}
                  </td>
                  <td style={cellStyle}><code>{receipt.leadgen_id}</code></td>
                  <td style={cellStyle}><code>{receipt.page_id ?? "—"}</code></td>
                  <td style={cellStyle}><code>{receipt.form_id ?? "—"}</code></td>
                  <td style={cellStyle}><code>{receipt.hubspot_contact_id ?? "—"}</code></td>
                  <td style={cellStyle}><code>{receipt.hubspot_deal_id ?? "—"}</code></td>
                  <td style={cellStyle}>{receipt.attempts}</td>
                  <td style={cellStyle}>{dateTime(receipt.lease_until)}</td>
                  <td style={{ ...cellStyle, maxWidth: 220, whiteSpace: "normal" }}>{receipt.last_error ?? "—"}</td>
                  <td style={cellStyle}>{dateTime(receipt.retry_at)}</td>
                  <td style={cellStyle}>{dateTime(receipt.received_at)}</td>
                  <td style={cellStyle}>{dateTime(receipt.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const cellStyle: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--line)",
  verticalAlign: "top",
  fontVariantNumeric: "tabular-nums",
  overflowWrap: "anywhere",
};
