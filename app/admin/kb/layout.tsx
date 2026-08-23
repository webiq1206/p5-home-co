/**
 * Knowledge Center layout and gate.
 *
 * Open to every signed-in staff role - the whole point is that a first-day
 * admin can read how everything works. (Finance PAGES stay role-gated; the
 * documentation about them is not secret to staff.)
 *
 * The section menu comes from AdminChrome; the nav below is the Knowledge
 * Center's own pages.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import AdminChrome from "../AdminChrome.tsx";
import "./kb.css";

export default async function KbLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  return (
    <>
      <AdminChrome user={user} active="kb" subtitle="Knowledge Center" />
      <nav className="kb-nav" aria-label="Knowledge Center pages">
        <Link href="/admin/kb" className="kb-nav-link">
          Home
        </Link>
        <Link href="/admin/kb/search" className="kb-nav-link">
          Search
        </Link>
        <Link href="/admin/kb/ask" className="kb-nav-link">
          Ask P5
        </Link>
      </nav>
      {children}
    </>
  );
}
