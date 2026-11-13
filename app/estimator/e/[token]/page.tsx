import type { Metadata } from "next";
import { notFound } from "next/navigation";

import EstimateView from "@/components/estimator/EstimateView";
import styles from "@/components/estimator/GuidedEstimator.module.css";
import { brandConfig } from "@/app/lib/estimator/brands";
import { guidedByToken, recordEvent } from "@/app/lib/estimator/store";
import { isDatabaseConfigured } from "@/app/lib/db";

/**
 * A customer's saved estimate, opened from the link in their email. The token
 * is the only way in. The page renders the stored customer view, exactly as
 * it was shown, so a later cost book change does not move an old estimate.
 */
export const metadata: Metadata = { title: "Your estimate", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SavedEstimate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isDatabaseConfigured()) notFound();
  const row = await guidedByToken(token).catch(() => null);
  if (!row) notFound();
  const brand = brandConfig(row.brand) ?? brandConfig("p5")!;
  await recordEvent({ session: `view-${row.token.slice(0, 24)}`, brand: brand.id, project: row.project, name: "estimate_viewed", step: null, attribution: null }).catch(() => false);
  return (
    <main id="main-content">
      <div className={styles.shell} style={{ "--ge-accent": brand.accent, "--ge-accent-ink": brand.accentInk } as React.CSSProperties}>
        <EstimateView estimate={row.customer_view} phoneDisplay={brand.phoneDisplay} phoneTel={brand.phoneTel} />
      </div>
    </main>
  );
}
