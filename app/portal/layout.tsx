/**
 * Portal shell for external vendors and clients (S151/S152). Reuses the admin
 * design vocabulary; never indexed.
 */

import type { Metadata } from "next";

import "../admin/admin.css";
import "../admin/finance/finance.css";
import "./portal.css";

export const metadata: Metadata = {
  title: "P5 Home Co Portal",
  robots: { index: false, follow: false, nocache: true },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-body">{children}</div>;
}
