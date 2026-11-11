/**
 * Project list: every saved scope, searchable by client, project name or
 * address, filterable by scope and estimate status, sortable, with archived
 * records one tap away rather than cluttering the active list.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import { checkDatabase, describeSchemaError } from "../../lib/db.ts";
import { ESTIMATE_STATUS_LABEL, estimateStatus, type EstimateStatusName } from "../../lib/scopes/estimate.ts";
import { listProjects, type ListRow } from "../../lib/scopes/store.ts";
import AdminChrome from "../AdminChrome.tsx";
import NewProject from "./_components/NewProject.tsx";
import "./_components/scopes.css";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = {
  in_progress: "In progress",
  needs_information: "Needs information",
  ready: "Ready",
};

function when(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Boise", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

function clientName(p: ListRow): string {
  return [p.client_first_name, p.client_last_name].filter(Boolean).join(" ") || p.qbo_customer_name || "Client not set";
}

export default async function ScopeList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">{health.problem}</h1>
        <p className="admin-sub">{health.detail}</p>
      </main>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const sp = await searchParams;
  const q = sp.q ?? "";
  const scope = (["in_progress", "needs_information", "ready"].includes(sp.scope ?? "") ? sp.scope : "") as ListRow["scope_status"] | "";
  const estimate = sp.estimate ?? "";
  const sort = (["updated", "client", "created"].includes(sp.sort ?? "") ? sp.sort : "updated") as "updated" | "client" | "created";
  const archived = sp.archived === "1";

  let rows: (ListRow & { est: EstimateStatusName })[] = [];
  let error: { problem: string; detail: string } | null = null;
  try {
    rows = (await listProjects({ q, scope, archived, sort })).map((r) => ({
      ...r,
      est: estimateStatus(r.estimate_raw as never, Boolean(r.estimate_qbo_id)),
    }));
    if (estimate) rows = rows.filter((r) => r.est === estimate);
  } catch (e) {
    error = describeSchemaError(e);
  }

  return (
    <>
      <AdminChrome user={user} active="scopes" subtitle="Scopes" />
      <main className="admin-main sc-main">
        <div className="sc-head">
          <div>
            <h1 className="admin-h1">{archived ? "Archived projects" : "Projects"}</h1>
            <p className="admin-sub">Record a walkthrough, review the scope, fill gaps and create the QuickBooks estimate.</p>
          </div>
          <NewProject />
        </div>

        <form className="sc-filters" role="search" action="/admin/scopes">
          <label className="sc-field sc-grow">
            <span>Search</span>
            <input name="q" defaultValue={q} placeholder="Client, project or address" type="search" />
          </label>
          <label className="sc-field">
            <span>Scope</span>
            <select name="scope" defaultValue={scope}>
              <option value="">Any</option>
              {Object.entries(SCOPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="sc-field">
            <span>Estimate</span>
            <select name="estimate" defaultValue={estimate}>
              <option value="">Any</option>
              {Object.entries(ESTIMATE_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="sc-field">
            <span>Sort</span>
            <select name="sort" defaultValue={sort}>
              <option value="updated">Last updated</option>
              <option value="client">Client name</option>
              <option value="created">Newest</option>
            </select>
          </label>
          {archived && <input type="hidden" name="archived" value="1" />}
          <button className="sc-btn" type="submit">Apply</button>
        </form>

        <p className="sc-switch">
          {archived ? <Link href="/admin/scopes">Show active projects</Link> : <Link href="/admin/scopes?archived=1">Show archived projects</Link>}
          {" · "}
          <Link href="/admin/scopes/settings">Pricing setup</Link>
        </p>

        {error && (
          <div className="sc-alert sc-alert-bad" role="alert">
            <b>{error.problem}</b> {error.detail}
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="sc-empty">{q || scope || estimate ? "No projects match these filters." : archived ? "Nothing is archived." : "No projects yet. Start one with New project."}</p>
        )}

        <ul className="sc-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/scopes/${r.id}`} className="sc-row">
                <span className="sc-row-main">
                  <b>{clientName(r)}</b>
                  <span>{r.title || r.project_address || "Untitled project"}</span>
                  {r.title && r.project_address && <span className="sc-muted">{r.project_address}</span>}
                </span>
                <span className="sc-row-meta">
                  <span className={`sc-pill sc-pill-${r.scope_status}`}>Scope: {SCOPE_LABEL[r.scope_status]}</span>
                  <span className={`sc-pill sc-pill-est-${r.est}`}>Estimate: {ESTIMATE_STATUS_LABEL[r.est]}</span>
                  <span className={`sc-pill ${r.qbo_project_id ? "sc-pill-ready" : ""}`}>Project: {r.qbo_project_id ? "Linked" : "Not linked"}</span>
                  <span className="sc-muted">Updated {when(new Date(r.updated_at))}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
