"use client";

/**
 * Finance navigation.
 *
 * Nineteen equal-weight tabs is not a menu, it is a wall. This groups them into
 * a handful of destinations that match what someone actually came here to do,
 * and only shows the detail tabs for wherever they are. Every old route still
 * works; what changed is how much you have to look at to find one.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };
type Section = { href: string; label: string; blurb: string; items: Item[] };

export const SECTIONS: Section[] = [
  {
    href: "/admin/finance",
    label: "Today",
    blurb: "What needs you, and this morning's snapshot",
    items: [
      { href: "/admin/finance", label: "Needs your attention" },
      { href: "/admin/finance/daily-report", label: "Daily snapshot" },
      { href: "/admin/finance/data-quality", label: "QuickBooks check" },
    ],
  },
  {
    href: "/admin/finance/money-run",
    label: "Money",
    blurb: "What is safe to pay, and what is coming",
    items: [
      { href: "/admin/finance/money-run", label: "Weekly Money Run" },
      { href: "/admin/finance/cash-forecast", label: "Cash forecast" },
      { href: "/admin/finance/bills", label: "Bills to pay" },
    ],
  },
  {
    href: "/admin/finance/projects",
    label: "Projects",
    blurb: "Job health, funding and draws",
    items: [
      { href: "/admin/finance/projects", label: "Projects" },
      { href: "/admin/finance/funding", label: "Client funding" },
      { href: "/admin/finance/draws", label: "Lender draws" },
      { href: "/admin/finance/reports", label: "WIP & reports" },
    ],
  },
  {
    href: "/admin/finance/customers",
    label: "Customers",
    blurb: "Who owes P5, and how old it is",
    items: [{ href: "/admin/finance/customers", label: "Customers & AR" }],
  },
  {
    href: "/admin/finance/vendors",
    label: "Vendors",
    blurb: "Compliance, subcontracts and holds",
    items: [
      { href: "/admin/finance/vendors", label: "Vendors & compliance" },
      { href: "/admin/finance/subcontracts", label: "Subcontracts" },
    ],
  },
  {
    href: "/admin/finance/owners",
    label: "Company",
    blurb: "Owners, assets, obligations and tax",
    items: [
      { href: "/admin/finance/owners", label: "Owners" },
      { href: "/admin/finance/assets", label: "Assets & debt" },
      { href: "/admin/finance/registries", label: "Subscriptions & insurance" },
      { href: "/admin/finance/tax", label: "Tax center" },
    ],
  },
  {
    href: "/admin/finance/settings",
    label: "Setup",
    blurb: "Settings, portal access and system health",
    items: [
      { href: "/admin/finance/settings", label: "Settings" },
      { href: "/admin/finance/portal", label: "Portal access" },
      { href: "/admin/finance/health", label: "System health" },
    ],
  },
];

/** The section owning a path - longest matching item wins, so /draws/1 works. */
function activeSection(pathname: string): Section {
  let best: { section: Section; length: number } | null = null;
  for (const section of SECTIONS) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.length)) {
        best = { section, length: item.href.length };
      }
    }
  }
  return best?.section ?? SECTIONS[0];
}

export default function FinanceNav() {
  const pathname = usePathname() ?? "/admin/finance";
  const section = activeSection(pathname);

  return (
    <>
      <nav className="fin-nav" aria-label="Finance sections">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={`fin-nav-link${s.label === section.label ? " fin-nav-current" : ""}`}
            aria-current={s.label === section.label ? "page" : undefined}
          >
            {s.label}
          </Link>
        ))}
        <Link href="/admin/kb" className="fin-nav-link fin-nav-back">
          Knowledge Center →
        </Link>
        <Link href="/admin" className="fin-nav-link">
          Leads →
        </Link>
      </nav>

      {/* Only shown when the section has somewhere else to go. A single-page
          section does not need a tab strip pointing at itself. */}
      {section.items.length > 1 && (
        <nav className="fin-subnav" aria-label={`${section.label} pages`}>
          {section.items.map((item) => {
            const current =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`fin-subnav-link${current ? " fin-subnav-current" : ""}`}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
