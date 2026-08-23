/**
 * Knowledge Center layout and gate.
 *
 * Open to every signed-in staff role - the whole point is that a first-day
 * admin can read how everything works. (Finance PAGES stay role-gated; the
 * documentation about them is not secret to staff.)
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import "./kb.css";

export default async function KbLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  const finance = user.role === "administrator" || user.role === "manager";

  return (
    <>
      <header className="admin-bar">
        <div className="admin-brand">
          P5 <small>Knowledge Center</small>
        </div>
        <span className="admin-who">{user.fullName}</span>
      </header>
      <nav className="kb-nav" aria-label="Knowledge Center">
        <Link href="/admin/kb" className="kb-nav-link">
          Home
        </Link>
        <Link href="/admin/kb/search" className="kb-nav-link">
          Search
        </Link>
        <Link href="/admin/kb/ask" className="kb-nav-link">
          Ask P5
        </Link>
        <div className="kb-nav-right">
          <Link href="/admin" className="kb-nav-link">
            Leads →
          </Link>
          {finance && (
            <Link href="/admin/finance" className="kb-nav-link">
              Finance →
            </Link>
          )}
        </div>
      </nav>
      {children}
    </>
  );
}
