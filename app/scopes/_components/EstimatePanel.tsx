"use client";

/**
 * Confirm the client, pick or create the QuickBooks customer, create the
 * estimate (left unsent), and follow its status. Three statuses are tracked
 * separately: scope, QuickBooks estimate, and QuickBooks project.
 */

import { useEffect, useRef, useState } from "react";

import AddressField from "./AddressField.tsx";
import { api, money, when, type Workspace } from "./client.ts";

type Candidate = { qboId: string; displayName: string; email: string | null; phone: string | null; address: string | null; reasons: string[] };

const CLIENT_FIELDS: [keyof Workspace["project"], string, string][] = [
  ["client_first_name", "First name", "given-name"],
  ["client_last_name", "Last name", "family-name"],
  ["client_email", "Email", "email"],
  ["client_phone", "Phone", "tel"],
  ["project_address", "Project address", "street-address"],
];

export default function EstimatePanel({ ws, onWorkspace, onScope }: { ws: Workspace; onWorkspace: (w: Workspace) => void; onScope: () => void }) {
  const p = ws.project;
  // An estimate QuickBooks confirms was deleted is history, not the current estimate.
  const deleted = ws.estimate?.status === "deleted" ? ws.estimate : null;
  const e = deleted ? null : ws.estimate;
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries([...CLIENT_FIELDS.map(([k]) => [k, String(p[k] ?? "")]), ["billing_address", p.billing_address ?? ""]]),
  );
  const [billingDifferent, setBillingDifferent] = useState(Boolean(p.billing_address && p.billing_address !== p.project_address));
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [projects, setProjects] = useState<{ qboId: string; name: string; isProject: boolean }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const missingClient = CLIENT_FIELDS.filter(([k]) => !String(p[k] ?? "").trim()).map(([, l]) => l);
  const dirty = CLIENT_FIELDS.some(([k]) => (form[k] ?? "") !== String(p[k] ?? "")) || (billingDifferent ? form.billing_address : "") !== (p.billing_address ?? "");
  const ready = ws.readiness.status === "ready";
  const behind = e && ws.version && e.versionId !== ws.version.id;

  async function act(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const estimateAction = (body: Record<string, unknown>) =>
    api<{ workspace?: Workspace; candidates?: Candidate[]; projects?: typeof projects }>(`/api/scopes/${p.id}/estimate`, { method: "POST", json: body });

  const saveClient = () =>
    act("client", async () => {
      const { workspace } = await api<{ workspace: Workspace }>(`/api/scopes/${p.id}`, {
        method: "PATCH",
        json: { ...form, billing_address: billingDifferent ? form.billing_address : null },
      });
      onWorkspace(workspace);
      setNotice("Client details saved.");
    });

  const qboDown = !ws.qbo.connected;

  // QuickBooks is checked for this client as soon as the details are saved, with
  // no button to press. It is checked again whenever the saved details change.
  const lookupFor = [p.client_first_name, p.client_last_name, p.client_email, p.client_phone, p.project_address].join("|");
  const lookedUp = useRef<string | null>(null);
  const [searching, setSearching] = useState(false);
  const canLookUp = !p.qbo_customer_id && !qboDown && missingClient.length === 0;
  const findCustomer = async (signature: string) => {
    lookedUp.current = signature;
    setSearching(true);
    setError(null);
    try {
      const res = await api<{ candidates?: Candidate[] }>(`/api/scopes/${p.id}/estimate`, { method: "POST", json: { action: "customers" } });
      // A slower, older search must not replace the result for newer details.
      if (lookedUp.current === signature) setCandidates(res.candidates ?? []);
    } catch (err) {
      if (lookedUp.current === signature) setError((err as Error).message);
    } finally {
      if (lookedUp.current === signature) setSearching(false);
    }
  };
  useEffect(() => {
    if (!canLookUp || lookedUp.current === lookupFor) return;
    const t = setTimeout(() => void findCustomer(lookupFor), 0);
    return () => clearTimeout(t);
    // findCustomer only reads the project id and the signature passed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLookUp, lookupFor, p.id]);

  return (
    <div className="sc-estimate">

      {!ready && (
        <section className="sc-card sc-card-warn">
          <h2 className="sc-h2">Not ready to create the estimate</h2>
          <ul className="sc-plain">{ws.readiness.blockers.slice(0, 10).map((b, i) => <li key={i}>{b}</li>)}</ul>
          <button type="button" className="sc-link" onClick={onScope}>Go to the scope</button>
        </section>
      )}

      <section className="sc-card">
        <h2 className="sc-h2">1. Client</h2>
                <form onSubmit={(ev) => { ev.preventDefault(); void saveClient(); }}>
          <div className="sc-two">
            {CLIENT_FIELDS.slice(0, 4).map(([k, label, ac]) => (
              <label key={k} className="sc-field">
                <span>{label}{!String(p[k] ?? "").trim() && <em className="sc-req"> needed</em>}</span>
                <input value={form[k] ?? ""} autoComplete={ac} type={k === "client_email" ? "email" : k === "client_phone" ? "tel" : "text"} onChange={(ev) => setForm({ ...form, [k]: ev.target.value })} />
              </label>
            ))}
          </div>
          <AddressField
            label={<>Project address{!p.project_address && <em className="sc-req"> needed</em>}</>}
            value={form.project_address ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, project_address: v }))}
          />
          <label className="sc-check">
            <input type="checkbox" checked={billingDifferent} onChange={(ev) => setBillingDifferent(ev.target.checked)} /> Billing address is different
          </label>
          {billingDifferent && (
            <AddressField label="Billing address" value={form.billing_address ?? ""} onChange={(v) => setForm((f) => ({ ...f, billing_address: v }))} />
          )}
          <button type="submit" className="sc-btn" disabled={!dirty || !!busy}>{busy === "client" ? "Saving..." : "Save client details"}</button>
        </form>
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">2. QuickBooks customer</h2>
        {p.qbo_customer_id ? (
          <p>Using <b>{p.qbo_customer_name}</b>.</p>
        ) : (
          <>
            {missingClient.length > 0 ? (
              <p className="sc-muted">Save the client&apos;s {missingClient.join(", ")} above. QuickBooks is then checked for this client automatically.</p>
            ) : qboDown ? (
              <p className="sc-muted">QuickBooks is not connected, so the client cannot be looked up yet.</p>
            ) : searching || candidates === null ? (
              <p role="status"><span className="sc-spinner" aria-hidden="true" /> Checking QuickBooks for this client...</p>
            ) : candidates.length === 0 ? (
              <>
                <p><b>Not in QuickBooks yet.</b> No customer matches this client&apos;s email, phone, name or address.</p>
                <button type="button" className="sc-btn sc-btn-primary sc-btn-big" disabled={!!busy} onClick={() => act("create-customer", async () => {
                  const res = await estimateAction({ action: "customer", create: true });
                  if (res.workspace) onWorkspace(res.workspace);
                })}>{busy === "create-customer" ? "Creating..." : `Create ${[p.client_first_name, p.client_last_name].filter(Boolean).join(" ") || "customer"} in QuickBooks`}</button>
              </>
            ) : (
              <>
                <p><b>{candidates.length === 1 ? "Found a possible match in QuickBooks." : `Found ${candidates.length} possible matches in QuickBooks.`}</b> Use the right one so no duplicate is created.</p>
                <ul className="sc-candidates">
                  {candidates.map((c) => (
                    <li key={c.qboId}>
                      <span>
                        <b>{c.displayName}</b> <span className="sc-muted sc-small">{[c.email, c.phone, c.address].filter(Boolean).join(" · ")}</span>
                        <span className="sc-small sc-block">Match: {c.reasons.join(", ")}</span>
                      </span>
                      <button type="button" className={`sc-btn${candidates.length === 1 ? " sc-btn-primary" : " sc-btn-small"}`} disabled={!!busy} onClick={() => act("use", async () => {
                        const res = await estimateAction({ action: "customer", qboId: c.qboId });
                        if (res.workspace) onWorkspace(res.workspace);
                      })}>Use this customer</button>
                    </li>
                  ))}
                  <li>
                    <span>{candidates.length === 1 ? "Not the same person?" : "None of these is the client?"}</span>
                    <button type="button" className="sc-btn sc-btn-small" disabled={!!busy} onClick={() => act("create-customer", async () => {
                      const res = await estimateAction({ action: "customer", create: true });
                      if (res.workspace) onWorkspace(res.workspace);
                    })}>{busy === "create-customer" ? "Creating..." : "Create new customer"}</button>
                  </li>
                </ul>
              </>
            )}
            {canLookUp && !searching && candidates !== null && (
              <p><button type="button" className="sc-link sc-small" disabled={!!busy} onClick={() => void findCustomer(lookupFor)}>Check QuickBooks again</button></p>
            )}
          </>
        )}
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">3. QuickBooks estimate</h2>
        {e ? (
          <>
            <p>
              Estimate {e.docNumber ? `#${e.docNumber}` : ""} for {money(e.total)}, from scope version {e.versionNo ?? "?"}.{" "}
              {e.url && <a href={e.url} target="_blank" rel="noreferrer">Open in QuickBooks</a>}
            </p>
            {(e.status === "created_unsent" || e.status === "sent") && (
              <div className="sc-send">
                <p className={e.status === "sent" ? "" : "sc-muted"}>
                  {e.status === "sent"
                    ? <><b>Sent{e.sentTo ? ` to ${e.sentTo}` : ""}.</b> Waiting for the client to accept or decline. This page updates on its own when they do.</>
                    : "Not sent yet."}
                </p>
                {!ws.viewer.internal ? (
                  <p className="sc-small sc-muted">A P5 employee sends the estimate to the client.</p>
                ) : behind ? (
                  <p className="sc-small sc-muted">Update the estimate below before sending it.</p>
                ) : !p.client_email ? (
                  <p className="sc-small sc-muted">Save the client&apos;s email above to send it from here.</p>
                ) : confirmSend ? (
                  <div className="sc-revise" role="group" aria-label="Confirm sending">
                    <p>
                      QuickBooks will email estimate {e.docNumber ? `#${e.docNumber} ` : ""}for <b>{money(e.total)}</b> to <b>{p.client_email}</b> now.
                    </p>
                    <div className="sc-actions">
                      <button type="button" className="sc-btn sc-btn-primary" disabled={!!busy || qboDown} onClick={() => act("send", async () => {
                        const res = await estimateAction({ action: "send", email: p.client_email });
                        if (res.workspace) onWorkspace(res.workspace);
                        setConfirmSend(false);
                        setNotice(`Estimate sent to ${p.client_email}.`);
                      })}>{busy === "send" ? "Sending..." : "Send now"}</button>
                      <button type="button" className="sc-btn" disabled={!!busy} onClick={() => setConfirmSend(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={`sc-btn${e.status === "sent" ? "" : " sc-btn-primary sc-btn-big"}`} disabled={!!busy || qboDown} onClick={() => setConfirmSend(true)}>
                    {e.status === "sent" ? "Send again" : "Send estimate to client"}
                  </button>
                )}
              </div>
            )}
            {e.status === "accepted" && (
              <p>
                <b>Accepted{e.acceptedBy ? ` by ${e.acceptedBy}` : ""}{e.acceptedDate ? ` on ${e.acceptedDate}` : ""}.</b>{" "}
                {p.qbo_project_id ? "The QuickBooks project has been created. The job continues in QuickBooks; this page keeps following it." : "The QuickBooks project is being created automatically."}
              </p>
            )}
            {e.status === "declined" && <p><b>Declined.</b> The client did not approve this estimate in QuickBooks.</p>}
            {e.status === "closed" && <p><b>Closed in QuickBooks.</b></p>}
            {e.status === "converted" && (
              <p>
                <b>Invoiced.</b>{" "}
                {e.invoiced ? `${money(e.invoiced.total)} invoiced so far, ${money(e.invoiced.balance)} still owed.` : "QuickBooks has turned this estimate into an invoice."}
              </p>
            )}
            {e.status === "paid" && (
              <p><b>Completed.</b> {e.invoiced ? `${money(e.invoiced.total)} invoiced and paid in full.` : "Invoiced and paid in full."}</p>
            )}
            {e.drift?.changed && (
              <div className="sc-alert sc-alert-warn" role="alert">
                <b>Changed directly in QuickBooks.</b> These differ from what was sent with scope version {e.versionNo}:
                <ul className="sc-plain">{e.drift.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                Earlier QuickBooks versions are kept under History.
              </div>
            )}
            {behind && ["created_unsent", "sent"].includes(e.status) && (
              <div className="sc-revise">
                <p>The scope has changed since this estimate was created (now version {ws.version?.versionNo}).</p>
                {e.drift?.changed && (
                  <label className="sc-check">
                    <input type="checkbox" checked={confirmOverwrite} onChange={(ev) => setConfirmOverwrite(ev.target.checked)} /> Replace the changes made in QuickBooks
                  </label>
                )}
                <button type="button" className="sc-btn sc-btn-primary" disabled={!ready || !!busy || qboDown || (e.drift?.changed && !confirmOverwrite)} onClick={() => act("revise", async () => {
                  const res = await estimateAction({ action: "create", overwrite: confirmOverwrite });
                  if (res.workspace) onWorkspace(res.workspace);
                  setNotice("The QuickBooks estimate now matches the current scope. It is still unsent.");
                })}>
                  {busy === "revise" ? "Updating..." : `Update the estimate to version ${ws.version?.versionNo}`}
                </button>
              </div>
            )}
            {behind && !["created_unsent", "sent"].includes(e.status) && (
              <p className="sc-muted">This estimate is {e.statusLabel.toLowerCase()}. Record further changes as a change order in QuickBooks.</p>
            )}
          </>
        ) : (
          <>
            {deleted && (
              <p className="sc-alert sc-alert-warn">
                The earlier estimate{deleted.docNumber ? ` #${deleted.docNumber}` : ""} was deleted in QuickBooks. Its history is kept below. You can create a new one.
              </p>
            )}
            <p className="sc-muted">
              Creates the estimate in QuickBooks. It is not sent until you send it.
            </p>
            <button
              type="button"
              className="sc-btn sc-btn-primary sc-btn-big"
              disabled={!ready || !p.qbo_customer_id || missingClient.length > 0 || !!busy || qboDown}
              onClick={() => act("create", async () => {
                const res = await estimateAction({ action: "create" });
                if (res.workspace) onWorkspace(res.workspace);
                setNotice("Estimate created in QuickBooks. It has not been sent yet.");
              })}
            >
              {busy === "create" ? "Creating estimate..." : `Create estimate (${money(ws.pricing.totals.basePrice)})`}
            </button>
            {qboDown && <p className="sc-small sc-muted">QuickBooks must be connected first.</p>}
          </>
        )}
      </section>

      {p.qbo_project_id ? (
        <section className="sc-card">
          <h2 className="sc-h2">4. QuickBooks project</h2>
        {p.qbo_project_id ? (
          <p>
            Linked to <b>{p.qbo_project_name}</b> on {when(p.qboProjectLinkedAt)}.
            {p.qboProjectIsProject === false && " QuickBooks holds it as a sub-customer, not a Project; convert it in QuickBooks if needed."}
          </p>
        ) : (
          <>
            <p className="sc-muted">
              {e?.status === "accepted" || e?.status === "converted" || e?.status === "paid"
                ? "The project is created in QuickBooks automatically once the estimate is accepted. If it has not appeared, create or link it here."
                : "Nothing to do here. The project is created in QuickBooks automatically when the client accepts the estimate. Use these only to link a project that already exists."}
            </p>
            <div className="sc-actions">
              <button type="button" className="sc-btn" disabled={!p.qbo_customer_id || !!busy || qboDown} onClick={() => act("projects", async () => {
                const res = await estimateAction({ action: "projects", refresh: true });
                setProjects(res.projects ?? []);
              })}>{busy === "projects" ? "Checking..." : "Find existing projects"}</button>
              <button type="button" className="sc-btn" disabled={!p.qbo_customer_id || !!busy || qboDown} onClick={() => act("create-project", async () => {
                const res = await estimateAction({ action: "create-project" });
                if (res.workspace) onWorkspace(res.workspace);
              })}>{busy === "create-project" ? "Creating..." : "Create project in QuickBooks"}</button>
            </div>
            {projects && (
              <ul className="sc-candidates">
                {projects.length === 0 && <li>No projects under this customer yet.</li>}
                {projects.map((x) => (
                  <li key={x.qboId}>
                    <span>{x.name} <span className="sc-muted sc-small">{x.isProject ? "Project" : "Sub-customer"}</span></span>
                    <button type="button" className="sc-btn sc-btn-small" disabled={!!busy} onClick={() => act("link", async () => {
                      const res = await estimateAction({ action: "link-project", qboId: x.qboId });
                      if (res.workspace) onWorkspace(res.workspace);
                    })}>Link</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        </section>
      ) : (
        <details className="sc-card sc-more">
          <summary>4. QuickBooks project <span className="sc-muted">created automatically on acceptance</span></summary>
        {p.qbo_project_id ? (
          <p>
            Linked to <b>{p.qbo_project_name}</b> on {when(p.qboProjectLinkedAt)}.
            {p.qboProjectIsProject === false && " QuickBooks holds it as a sub-customer, not a Project; convert it in QuickBooks if needed."}
          </p>
        ) : (
          <>
            <p className="sc-muted">
              {e?.status === "accepted" || e?.status === "converted" || e?.status === "paid"
                ? "The project is created in QuickBooks automatically once the estimate is accepted. If it has not appeared, create or link it here."
                : "Nothing to do here. The project is created in QuickBooks automatically when the client accepts the estimate. Use these only to link a project that already exists."}
            </p>
            <div className="sc-actions">
              <button type="button" className="sc-btn" disabled={!p.qbo_customer_id || !!busy || qboDown} onClick={() => act("projects", async () => {
                const res = await estimateAction({ action: "projects", refresh: true });
                setProjects(res.projects ?? []);
              })}>{busy === "projects" ? "Checking..." : "Find existing projects"}</button>
              <button type="button" className="sc-btn" disabled={!p.qbo_customer_id || !!busy || qboDown} onClick={() => act("create-project", async () => {
                const res = await estimateAction({ action: "create-project" });
                if (res.workspace) onWorkspace(res.workspace);
              })}>{busy === "create-project" ? "Creating..." : "Create project in QuickBooks"}</button>
            </div>
            {projects && (
              <ul className="sc-candidates">
                {projects.length === 0 && <li>No projects under this customer yet.</li>}
                {projects.map((x) => (
                  <li key={x.qboId}>
                    <span>{x.name} <span className="sc-muted sc-small">{x.isProject ? "Project" : "Sub-customer"}</span></span>
                    <button type="button" className="sc-btn sc-btn-small" disabled={!!busy} onClick={() => act("link", async () => {
                      const res = await estimateAction({ action: "link-project", qboId: x.qboId });
                      if (res.workspace) onWorkspace(res.workspace);
                    })}>Link</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        </details>
      )}

      {notice && <p className="sc-alert sc-alert-good" role="status">{notice}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}

      <section className="sc-card sc-sync">
        <p className="sc-small sc-muted">
          QuickBooks {ws.qbo.connected ? "connected" : ws.qbo.configured ? "not connected" : "not configured"}
          {ws.qbo.sandbox ? " (sandbox)" : ""}.{e ? ` Estimate status last refreshed ${when(e.lastSyncedAt)}.` : ""}
          {ws.qbo.lastSuccess ? ` Last successful QuickBooks sync ${when(ws.qbo.lastSuccess)}.` : ""}
        </p>
        {e?.error && <p className="sc-alert sc-alert-bad" role="alert">Status refresh failed: {e.error}. The status shown is from {when(e.lastSyncedAt)}.</p>}
        {ws.qbo.error && <p className="sc-alert sc-alert-warn">QuickBooks sync reported: {ws.qbo.error}</p>}
        {e && (
          <button type="button" className="sc-btn" disabled={!!busy || qboDown} onClick={() => act("refresh", async () => {
            const res = await estimateAction({ action: "refresh" });
            if (res.workspace) onWorkspace(res.workspace);
            setNotice("Status refreshed from QuickBooks.");
          })}>
            {busy === "refresh" ? "Refreshing..." : "Refresh from QuickBooks"}
          </button>
        )}
      </section>

      {ws.estimate && ws.estimate.snapshots.length > 0 && (
        <details className="sc-card sc-more">
          <summary>QuickBooks history ({ws.estimate.snapshots.length})</summary>
          <ul className="sc-plain">
            {ws.estimate.snapshots.map((s, i) => (
              <li key={i}>{when(s.capturedAt)}: {s.source}, total {money(s.total)}{s.syncToken ? ` (QuickBooks revision ${s.syncToken})` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
