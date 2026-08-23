/**
 * P5 Finance: layout, navigation and the server-side role gate (S168).
 *
 * Finance is visible to administrators and managers only. Enforcement is
 * server-side here - every page under /admin/finance renders through this
 * layout - and each server action re-checks on its own (defense in depth).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import "./finance.css";

const NAV: { href: string; label: string }[] = [
  { href: "/admin/finance", label: "Attention" },
  { href: "/admin/finance/money-run", label: "Money Run" },
  { href: "/admin/finance/projects", label: "Projects" },
  { href: "/admin/finance/vendors", label: "Vendors" },
  { href: "/admin/finance/registries", label: "Registries" },
  { href: "/admin/finance/owners", label: "Owners" },
  { href: "/admin/finance/portal", label: "Portal" },
  { href: "/admin/finance/settings", label: "Settings" },
  { href: "/admin/finance/health", label: "Health" },
];

export default async function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "administrator" && user.role !== "manager") {
    redirect("/admin");
  }

  return (
    <>
      <header className="admin-bar">
        <div className="admin-brand">
          P5 Finance <small>Financial Operating System</small>
        </div>
        <span className="admin-who">{user.fullName}</span>
      </header>
      <nav className="fin-nav" aria-label="Finance sections">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="fin-nav-link">
            {item.label}
          </Link>
        ))}
        <Link href="/admin" className="fin-nav-link fin-nav-back">
          Leads →
        </Link>
      </nav>
      {children}
    </>
  );
}
