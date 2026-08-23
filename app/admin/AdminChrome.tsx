/**
 * The shared admin chrome: the brand bar and the top-level section menu.
 *
 * Before this existed each section rendered its own header and there was no
 * way to move between them except by knowing the URL. One component now owns
 * the menu, so a section added here appears everywhere at once and the menu
 * can never disagree with itself.
 *
 * Finance is role-gated in its own layout; the link is hidden for roles that
 * would only be redirected away (unauthorized controls are not rendered).
 */

import Link from "next/link";

import type { SessionUser } from "../lib/auth.ts";

export type AdminSection = "dashboard" | "leads" | "finance" | "kb";

type Item = { id: AdminSection; href: string; label: string; financeOnly?: boolean };

const SECTIONS: Item[] = [
  { id: "dashboard", href: "/admin", label: "Dashboard" },
  { id: "leads", href: "/admin/lead-manager", label: "Lead Manager" },
  { id: "finance", href: "/admin/finance", label: "Finance", financeOnly: true },
  { id: "kb", href: "/admin/kb", label: "Knowledge Center" },
];

export function canSeeFinance(role: SessionUser["role"]): boolean {
  return role === "administrator" || role === "manager";
}

export default function AdminChrome({
  user,
  active,
  subtitle,
}: {
  user: SessionUser;
  active: AdminSection;
  subtitle?: string;
}) {
  const finance = canSeeFinance(user.role);
  const items = SECTIONS.filter((s) => !s.financeOnly || finance);

  return (
    <>
      <header className="admin-bar">
        <Link href="/admin" className="admin-brand">
          P5 <small>{subtitle ?? "Operations"}</small>
        </Link>
        <span className="admin-bar-right">
          <span className="admin-who">
            {user.fullName} · {user.role.replace(/_/g, " ")}
          </span>
          <form action="/api/auth/signout" method="post">
            <button type="submit" className="admin-signout">
              Sign out
            </button>
          </form>
        </span>
      </header>

      <nav className="admin-nav" aria-label="Admin sections">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`admin-nav-link${item.id === active ? " admin-nav-link-active" : ""}`}
            aria-current={item.id === active ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
