/** Who may use the scope platform without being a P5 employee. Administrators only. */

import Link from "next/link";
import { redirect } from "next/navigation";

import { can, getScopeUser } from "../../lib/auth.ts";
import { listPeople } from "../../lib/scopes/people.ts";
import PeopleClient from "../_components/PeopleClient.tsx";
import ScopesChrome from "../_components/ScopesChrome.tsx";
import "../_components/scopes.css";

export const dynamic = "force-dynamic";

export default async function ScopePeople() {
  const user = await getScopeUser();
  if (!user) redirect("/scopes/login");
  if (user.scopesOnly) redirect("/scopes");
  const canManage = can(user.role, "manage_users");
  const people = canManage ? await listPeople() : [];
  return (
    <>
      <ScopesChrome user={user} />
      <main className="admin-main sc-main">
        <Link href="/scopes" className="sc-back">All projects</Link>
        <h1 className="admin-h1">People</h1>
        <p className="admin-sub">
          P5 employees already have access. Add contractors here to let them use Scopes only. They cannot open the admin panel, and they do not see internal cost,
          margin or pricing setup.
        </p>
        {canManage ? <PeopleClient initial={people} /> : <p className="sc-alert">Only an administrator can manage access.</p>}
      </main>
    </>
  );
}
