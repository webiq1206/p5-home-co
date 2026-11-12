import type { Metadata } from "next";
import "../admin/admin.css";

export const metadata: Metadata = {
  title: "P5 Scopes",
  // Client names, addresses and pricing: never indexed.
  robots: { index: false, follow: false, nocache: true },
};

export default function ScopesLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-body sc-app">{children}</div>;
}
