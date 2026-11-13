import type { Metadata } from "next";

import GuidedEstimator from "@/components/estimator/GuidedEstimator";
import SiteChrome from "@/components/SiteChrome";
import { BRAND_CONFIGS } from "@/app/lib/estimator/brands";
import { estimatorEntry } from "@/app/lib/estimator/flows";
import { estimatorImages } from "@/app/lib/estimator/images";

export const metadata: Metadata = {
  title: { absolute: "Instant estimate for your home project | P5 Home Co" },
  description: "Answer a few questions and see a free preliminary price range for remodeling, cabinets, repairs or new construction in Boise and the Treasure Valley. No appointment needed.",
  alternates: { canonical: "/estimator" },
};

export default async function EstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects } = BRAND_CONFIGS.p5;
  const entry = estimatorEntry(projects, { project: typeof params.project === "string" ? params.project : null, trade: typeof params.trade === "string" ? params.trade : null });
  return (
    <SiteChrome main>
      <GuidedEstimator brand={{ id, name, accent, accentInk, phoneDisplay, phoneTel, heading, intro, projects }} images={estimatorImages()} initialProject={entry.project} initialTrade={entry.trade} />
    </SiteChrome>
  );
}
