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
import FinanceNav from "./FinanceNav.tsx";

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
      <FinanceNav />
      {children}
      {/* The documents Intuit requires an app to publish, reachable from the
          software they govern rather than only by direct URL. */}
      <footer className="fin-legal">
        <span>P5 Home Co. LLC</span>
        {/* Intuit asks that an app give users a way to reach support from
            inside it, rather than only on a marketing page. */}
        <a href="mailto:accounting@p5homeco.com?subject=P5%20Finance%20support">
          Need help?
        </a>
        <Link href="/legal/terms">Terms of Use</Link>
        <Link href="/legal/privacy">Privacy Policy</Link>
        <Link href="/legal/quickbooks-disconnect">Disconnecting QuickBooks</Link>
      </footer>
    </>
  );
}
