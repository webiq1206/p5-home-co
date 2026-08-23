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
  return (
    <div className="admin-body">
      {children}
      {/* Vendors and clients need a way to reach a human from inside the
          portal. Without it their only route is replying to whichever email
          brought them here, which may not be monitored. */}
      <footer className="fin-legal">
        <span>P5 Home Co. LLC</span>
        <a href="mailto:accounting@p5homeco.com?subject=P5%20Portal%20question">
          Questions about this page?
        </a>
        <a href="/legal/privacy">Privacy Policy</a>
        <a href="/legal/terms">Terms of Use</a>
      </footer>
    </div>
  );
}
