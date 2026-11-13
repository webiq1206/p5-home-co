import type { Metadata } from "next";
import { notFound } from "next/navigation";

import GuidedEstimator from "@/components/estimator/GuidedEstimator";
import { brandConfig } from "@/app/lib/estimator/brands";
import { estimatorEntry } from "@/app/lib/estimator/flows";
import { estimatorImages } from "@/app/lib/estimator/images";
import EmbedBridge from "./EmbedBridge";

/**
 * The estimator on its own, for the brand sites to frame:
 *   /estimator/embed?brand=remodeling
 *
 * One deployment serves every brand, so a cost book or recipe change reaches
 * all of the sites at once. The framing page is the one search engines index.
 */
export const metadata: Metadata = { title: "Project estimator", robots: { index: false, follow: false } };

export default async function EstimatorEmbed({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const brand = brandConfig(typeof params.brand === "string" ? params.brand : null);
  // A brand that is not live yet has no public estimator, framed or not.
  if (!brand || !brand.live) notFound();
  const { id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects } = brand;
  const entry = estimatorEntry(projects, { project: typeof params.project === "string" ? params.project : null, trade: typeof params.trade === "string" ? params.trade : null });
  return (
    <main id="main-content">
      <EmbedBridge />
      <GuidedEstimator brand={{ id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects }} images={estimatorImages()} initialProject={entry.project} initialTrade={entry.trade} embedded />
    </main>
  );
}
