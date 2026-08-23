/**
 * P5 Finance: layout, navigation and the server-side role gate (S168).
 *
 * Finance is visible to administrators and managers only. Enforcement is
 * server-side here - every page under /admin/finance renders through this
 * layout - and each server action re-checks on its own (defense in depth).
 *
 * Two tiers of navigation: the shared section menu (AdminChrome) for moving
 * between the dashboard, leads, finance and the Knowledge Center, then the
 * finance sub-nav below it for the pages inside this section.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import AdminChrome from "../AdminChrome.tsx";
import "./finance.css";

const NAV: { href: string; label: string }[] = [
  { href: "/admin/finance", label: "Attention" },
  { href: "/admin/finance/daily-report", label: "Daily Report" },
  { href: "/admin/finance/money-run", label: "Money Run" },
  { href: "/admin/finance/cash-forecast", label: "Cash Forecast" },
  { href: "/admin/finance/projects", label: "Projects" },
  { href: "/admin/finance/funding", label: "Client Funding" },
  { href: "/admin/finance/customers", label: "Customers & AR" },
  { href: "/admin/finance/vendors", label: "Vendors" },
  { href: "/admin/finance/bills", label: "Bills & Payments" },
  { href: "/admin/finance/subcontracts", label: "Subcontracts" },
  { href: "/admin/finance/assets", label: "Assets & Debt" },
  { href: "/admin/finance/tax", label: "Tax Center" },
  { href: "/admin/finance/draws", label: "Draws" },
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
      <AdminChrome user={user} active="finance" subtitle="Financial Operating System" />
      <nav className="fin-nav" aria-label="Finance pages">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="fin-nav-link">
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
      {/* The documents Intuit requires an app to publish, reachable from the
          software they govern rather than only by direct URL. */}
      <footer className="fin-legal">
        <span>P5 Home Co. LLC</span>
        <Link href="/legal/terms">Terms of Use</Link>
        <Link href="/legal/privacy">Privacy Policy</Link>
        <Link href="/legal/quickbooks-disconnect">Disconnecting QuickBooks</Link>
      </footer>
    </>
  );
}
