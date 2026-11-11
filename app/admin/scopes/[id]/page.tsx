/** The project workspace: record, review scope, complete details, review pricing, create the estimate. */

import { notFound, redirect } from "next/navigation";

import { getSessionUser } from "../../../lib/auth.ts";
import { checkDatabase } from "../../../lib/db.ts";
import { loadWorkspace } from "../../../lib/scopes/workspace.ts";
import AdminChrome from "../../AdminChrome.tsx";
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
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();
  const { tab } = await searchParams;

  return (
    <>
      <AdminChrome user={user} active="scopes" subtitle="Scopes" />
      <main className="admin-main sc-main">
        <Workspace initial={workspace} initialTab={tab} />
      </main>
    </>
  );
}
