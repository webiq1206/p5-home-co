/**
 * Pricing releases. Administrators preview the P5 Cost Book, see every rate and
 * rule that would change, stage an immutable version, publish it, or restore an
 * earlier approved one. Draft workbook edits never change a live price.
 */
import { redirect } from "next/navigation";

import { getSessionUser } from "../../lib/auth.ts";
import AdminChrome from "../AdminChrome.tsx";
import PricingReleases from "./PricingReleases.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pricing releases | P5 Admin", robots: { index: false, follow: false } };

export default async function PricingReleasePage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "administrator") redirect("/admin");
  return (
    <>
    <AdminChrome user={user} active="pricing" subtitle="Pricing releases" />
    <main>
      <h1>Pricing releases</h1>
      <p className="lead-why">
        Every price on all five sites is computed from one approved release of the cost book and the bid rules.
        Editing the workbook changes nothing until a version is published here. Estimates already saved keep the
        release they were priced on.
      </p>
      <PricingReleases />
    </main>
    </>
  );
}
