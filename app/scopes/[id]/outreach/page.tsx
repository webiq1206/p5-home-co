import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getScopeUser } from "../../../lib/auth";
import { getProject } from "../../../lib/scopes/store";
import ScopesChrome from "../../_components/ScopesChrome";
import OutreachBoard from "./OutreachBoard";
import "../../_components/scopes.css";
import "../../../admin/contractors/contractors.css";

export const dynamic = "force-dynamic";

export default async function TradeOutreachPage({params}: {params: Promise<{id: string}>}) {
  const user = await getScopeUser();
  if (!user) redirect("/scopes/login");
  // Outside scopes-only users can never access P5's private vendor records.
  if (user.scopesOnly) notFound();
  const {id: rawId} = await params;
  if (!/^\d+$/.test(rawId)) notFound();
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const project = await getProject(id);
  if (!project) notFound();
  return <>
    <ScopesChrome user={user}/>
    <main className="admin-main ct-main">
      <nav className="ct-breadcrumb" aria-label="Project tools">
        <Link href={'/scopes/' + id}>Back to project</Link>
        <Link href="/admin/contractors">Contractor Directory</Link>
      </nav>
      <header className="ct-heading">
        <p className="ct-kicker">{project.title || "Project"}</p>
        <h1 className="admin-h1">Trade outreach</h1>
        <p className="admin-sub">Find qualified trades for the current scope, group bid requests, and track follow-ups.</p>
      </header>
      <OutreachBoard projectId={id} canEdit={user.role === "administrator" && !project.archived_at}/>
    </main>
  </>;
}
