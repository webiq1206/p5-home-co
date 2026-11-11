/** The project workspace: record, review scope, complete details, review pricing, create the estimate. */

import { notFound, redirect } from "next/navigation";

import { getScopeUser } from "../../lib/auth.ts";
import { checkDatabase } from "../../lib/db.ts";
import { loadWorkspace } from "../../lib/scopes/workspace.ts";
import ScopesChrome from "../_components/ScopesChrome.tsx";
import Workspace from "../_components/Workspace.tsx";
import "../_components/scopes.css";

export const dynamic = "force-dynamic";

export default async function ScopeWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
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
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workspace = await loadWorkspace(id, user);
  if (!workspace) notFound();
  const { tab } = await searchParams;

  return (
    <>
      <ScopesChrome user={user} />
      <main className="admin-main sc-main">
        <Workspace initial={workspace} initialTab={tab} />
      </main>
    </>
  );
}
