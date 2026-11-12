/**
 * Project list: every saved scope, searchable by client, project name or
 * address, filterable by scope and estimate status, sortable, with archived
 * records one tap away rather than cluttering the active list.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getScopeUser } from "../lib/auth.ts";
import { checkDatabase, describeSchemaError } from "../lib/db.ts";
import { ESTIMATE_STATUS_LABEL, estimateStatus, type EstimateStatusName } from "../lib/scopes/estimate.ts";
import { projectTitle } from "../lib/scopes/naming.ts";
import { listProjects, type ListRow } from "../lib/scopes/store.ts";
import ScopesChrome from "./_components/ScopesChrome.tsx";
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
  const user = await getScopeUser();
  if (!user) redirect("/scopes/login");

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
      <ScopesChrome user={user} />
      <main className="admin-main sc-main">
        <h1 className="admin-h1">{archived ? "Archived projects" : "Projects"}</h1>

        <NewProject />

        <form className="sc-search" role="search" action="/scopes">
          <label className="sc-visually-hidden" htmlFor="sc-q">Search projects</label>
          <input id="sc-q" name="q" defaultValue={q} placeholder="Search projects" type="search" enterKeyHint="search" />
          {scope && <input type="hidden" name="scope" value={scope} />}
          {estimate && <input type="hidden" name="estimate" value={estimate} />}
          {sort !== "updated" && <input type="hidden" name="sort" value={sort} />}
          {archived && <input type="hidden" name="archived" value="1" />}
        </form>

        <details className="sc-filter-toggle" open={Boolean(scope || estimate || sort !== "updated")}>
          <summary>Filter and sort</summary>
          <form className="sc-filter-row" action="/scopes">
            {q && <input type="hidden" name="q" value={q} />}
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
            <button className="sc-btn sc-btn-small" type="submit">Apply</button>
          </form>
        </details>

        {error && (
          <div className="sc-alert sc-alert-bad" role="alert">
            <b>{error.problem}</b> {error.detail}
          </div>
        )}

        {!error && rows.length === 0 && (
          <p className="sc-empty">{q || scope || estimate ? "No projects match these filters." : archived ? "Nothing is archived." : "No projects yet. Start one with New project."}</p>
        )}

        <ul className="sc-cards">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/scopes/${r.id}`} className="sc-job">
                <span className="sc-job-name">{projectTitle({ lastName: r.client_last_name, address: r.project_address, service: r.service })}</span>
                <span className="sc-job-sub">{[clientName(r), r.project_address].filter(Boolean).join(" · ")}</span>
                <span className="sc-job-meta">
                  <span className={`sc-pill sc-pill-${r.scope_status}`}>Scope: {SCOPE_LABEL[r.scope_status]}</span>
                  <span className={`sc-pill sc-pill-est-${r.estimate_error ? "unavailable" : r.est}`}>
                    Estimate: {ESTIMATE_STATUS_LABEL[r.est]}
                    {r.estimate_error ? " (last check failed)" : ""}
                  </span>
                  <span className={`sc-pill ${r.qbo_project_id ? "sc-pill-ready" : ""}`}>Project: {r.qbo_project_id ? "Linked" : "Not linked"}</span>
                </span>
                <span className="sc-muted sc-small">Updated {when(new Date(r.updated_at))}</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="sc-switch">
          {archived ? <Link href="/scopes">Show active projects</Link> : <Link href="/scopes?archived=1">Show archived projects</Link>}
          {!user.scopesOnly && (
            <>
              {" · "}
              <Link href="/scopes/settings">Pricing setup</Link>
              {" · "}
              <Link href="/scopes/people">People</Link>
            </>
          )}
        </p>
      </main>
    </>
  );
}
